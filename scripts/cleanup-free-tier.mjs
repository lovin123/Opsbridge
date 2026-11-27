#!/usr/bin/env node
/**
 * One-shot free-tier recovery for Upstash Redis + Aiven Postgres.
 *
 * Usage (from repo root):
 *   pnpm cleanup:free-tier
 *   node --env-file=.env scripts/cleanup-free-tier.mjs --redis-only
 *   node --env-file=.env scripts/cleanup-free-tier.mjs --obliterate-queue
 *
 * --obliterate-queue wipes ALL opsbridge queue data (including delayed escalations).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));

const { Queue } = apiRequire('bullmq');
const IORedis = apiRequire('ioredis');
const { Client } = apiRequire('pg');

const args = new Set(process.argv.slice(2));
const redisOnly = args.has('--redis-only');
const postgresOnly = args.has('--postgres-only');
const obliterate = args.has('--obliterate-queue');

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!postgresOnly && !redisUrl) {
  console.error('REDIS_URL is required (or pass --postgres-only)');
  process.exit(1);
}

function withPoolLimits(raw) {
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '2');
    }
    return url.toString();
  } catch {
    return raw;
  }
}

async function cleanRedis() {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  const queue = new Queue('opsbridge', { connection });

  try {
    if (obliterate) {
      await queue.obliterate({ force: true });
      console.log('Redis: obliterated opsbridge queue (all jobs + schedulers)');
    } else {
      const [completed, failed, wait] = await Promise.all([
        queue.clean(0, 5000, 'completed'),
        queue.clean(0, 5000, 'failed'),
        queue.clean(0, 5000, 'wait'),
      ]);
      // Do not wipe delayed jobs by default — those may be pending escalations.
      console.log(
        `Redis: pruned completed=${completed.length} failed=${failed.length} wait=${wait.length}`,
      );
    }

    const info = await connection.info('memory');
    const used = info
      .split('\n')
      .find((line) => line.startsWith('used_memory_human:'))
      ?.split(':')[1]
      ?.trim();
    if (used) {
      console.log(`Redis: used_memory_human=${used}`);
    }
  } finally {
    await queue.close();
    await connection.quit();
  }
}

async function cleanPostgres() {
  if (!databaseUrl) {
    console.warn('DATABASE_URL missing — skipping Postgres cleanup');
    return;
  }
  // Aiven free uses a provider CA; Node's default trust store often rejects it.
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const client = new Client({
    connectionString: withPoolLimits(databaseUrl),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const sessions = await client.query(`DELETE FROM "Session" WHERE "expiresAt" < NOW()`);
    const weekAgo = await client.query(
      `DELETE FROM "WebhookReceipt" WHERE "receivedAt" < NOW() - INTERVAL '7 days'`,
    );
    const grants = await client.query(
      `DELETE FROM "UploadGrant" WHERE "usedAt" IS NULL AND "expiresAt" < NOW()`,
    );
    const size = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
             (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections
    `);
    console.log(
      `Postgres: deleted sessions=${sessions.rowCount} receipts=${weekAgo.rowCount} grants=${grants.rowCount}`,
    );
    console.log(
      `Postgres: db_size=${size.rows[0].db_size} connections=${size.rows[0].connections}`,
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    if (previousTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
    }
  }
}

if (!postgresOnly) {
  try {
    await cleanRedis();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Redis cleanup skipped: ${message}`);
    if (message.includes('max requests limit')) {
      console.warn(
        'Upstash monthly command quota is exhausted. Set QUEUE_DRIVER=inline and wait for reset, or upgrade Redis.',
      );
    }
  }
}
if (!redisOnly) {
  await cleanPostgres();
}
console.log('Done.');

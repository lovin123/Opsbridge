import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /**
   * inline = process jobs in-process (recommended for Upstash free; avoids BullMQ command burn).
   * bullmq = Redis-backed queue (needs a Redis plan with high command allowance).
   */
  QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  SESSION_COOKIE_NAME: z.string().min(1).default('opsbridge_session'),
  NEXCONN_APP_KEY: z.string().optional().default(''),
  NEXCONN_APP_SECRET: z.string().optional().default(''),
  NEXCONN_AREA_CODE: z.string().default('SG'),
  NEXCONN_API_BASE_URL: z.string().default('https://api.sg-light-api.com'),
  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
  GROQ_FALLBACK_MODEL: z.string().optional().default('openai/gpt-oss-120b'),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  MAIL_FROM: z.string().min(1).default('Opsbridge <noreply@opsbridge.local>'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment\n${details}`);
  }
  return parsed.data;
}

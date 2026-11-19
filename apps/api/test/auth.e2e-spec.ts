import { execSync } from 'child_process';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

const password = 'FieldOps-demo-2026';

describe('Auth, tenancy, and RBAC', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await ensureTestDatabase();
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AuditLog", "Invitation", "Membership", "OrganizationRole", "PasswordResetToken", "Session", "Organization", "User" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports database and redis health', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('signs up, keeps a session cookie, and signs in again', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = uniqueEmail('session');

    const signup = await agent.post('/api/v1/auth/signup').send({
      name: 'Session User',
      email,
      password,
    });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe(email);
    expect(signup.body.user.nexconnUserId).toMatch(/^u[a-z0-9]+$/);
    expect(signup.headers['set-cookie']?.[0]).toContain('fieldops_session');

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    await agent.post('/api/v1/auth/signout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);

    const signin = await agent.post('/api/v1/auth/signin').send({ email, password });
    expect(signin.status).toBe(200);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('resets a password without revealing whether the email exists', async () => {
    const email = uniqueEmail('reset');
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/signup')
      .send({ name: 'Reset User', email, password })
      .expect(201);
    await agent.post('/api/v1/auth/signout').expect(204);

    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: uniqueEmail('missing') });
    expect(missing.status).toBe(200);
    expect(missing.body.devResetUrl).toBeUndefined();

    const issued = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email });
    expect(issued.status).toBe(200);
    expect(issued.body.message).toContain('If an account exists');
    const token = new URL(issued.body.devResetUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Updated-pass-2026' })
      .expect(200);

    await agent.post('/api/v1/auth/signin').send({ email, password }).expect(401);
    await agent
      .post('/api/v1/auth/signin')
      .send({ email, password: 'Updated-pass-2026' })
      .expect(200);
  });

  it('blocks a member from reading another organization', async () => {
    const alpha = request.agent(app.getHttpServer());
    const beta = request.agent(app.getHttpServer());
    await alpha
      .post('/api/v1/auth/signup')
      .send({ name: 'Alpha Admin', email: uniqueEmail('alpha'), password })
      .expect(201);
    await beta
      .post('/api/v1/auth/signup')
      .send({ name: 'Beta Admin', email: uniqueEmail('beta'), password })
      .expect(201);

    await alpha.post('/api/v1/organizations').send({ name: 'Alpha Facilities' }).expect(201);
    const betaOrg = await beta
      .post('/api/v1/organizations')
      .send({ name: 'Beta Logistics' })
      .expect(201);

    const denied = await alpha
      .get('/api/v1/organizations/current/members')
      .set('X-FieldOps-Organization', betaOrg.body.organization.id);
    expect(denied.status).toBe(403);
  });

  it('lets an admin invite a technician and denies technician admin actions', async () => {
    const admin = request.agent(app.getHttpServer());
    const technicianEmail = uniqueEmail('tech');
    await admin
      .post('/api/v1/auth/signup')
      .send({ name: 'Org Admin', email: uniqueEmail('admin'), password })
      .expect(201);
    const created = await admin
      .post('/api/v1/organizations')
      .send({ name: 'Role Check Org', industry: 'Facility management' })
      .expect(201);

    const invitation = await admin.post('/api/v1/organizations/current/invitations').send({
      email: technicianEmail,
      role: 'TECHNICIAN',
    });
    expect(invitation.status).toBe(201);
    const token = new URL(invitation.body.acceptPath).searchParams.get('token');

    const technician = request.agent(app.getHttpServer());
    await technician
      .post('/api/v1/auth/signup')
      .send({ name: 'Field Tech', email: technicianEmail, password })
      .expect(201);
    await technician.post('/api/v1/invitations/accept').send({ token }).expect(200);

    await technician
      .post('/api/v1/organizations/current/invitations')
      .send({ email: uniqueEmail('other'), role: 'TECHNICIAN' })
      .expect(403);

    await technician
      .patch(`/api/v1/organizations/current/members/${created.body.membershipId}`)
      .send({ role: 'TECHNICIAN' })
      .expect(403);

    const members = await admin.get('/api/v1/organizations/current/members').expect(200);
    const technicianRow = members.body.find(
      (member: { email: string }) => member.email === technicianEmail,
    );
    expect(technicianRow.role).toBe('TECHNICIAN');

    const promoted = await admin
      .patch(`/api/v1/organizations/current/members/${technicianRow.membershipId}`)
      .send({ role: 'SUPERVISOR' });
    expect(promoted.status).toBe(200);
    expect(
      promoted.body.find((member: { email: string }) => member.email === technicianEmail).role,
    ).toBe('SUPERVISOR');

    await admin
      .patch(`/api/v1/organizations/current/members/${created.body.membershipId}`)
      .send({ role: 'TECHNICIAN' })
      .expect(409);
  });
});

function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.com`;
}

async function ensureTestDatabase(): Promise<void> {
  const admin = new Client({
    connectionString: 'postgresql://fieldops:fieldops@127.0.0.1:5433/fieldops',
  });
  await admin.connect();
  const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'fieldops_test'");
  if (existing.rowCount === 0) {
    await admin.query('CREATE DATABASE fieldops_test');
  }
  await admin.end();
}

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { roleTemplateDefaults, type MemberRole } from '@fieldops/shared';
import { newUserIdentity } from '../src/common/ids';
import { hashPassword } from '../src/common/password';

loadEnv({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

interface DemoUser {
  email: string;
  name: string;
  role: MemberRole;
  jobTitle: string;
}

const roleSlug: Record<MemberRole, string> = {
  ORG_ADMIN: 'org-admin',
  OPERATIONS_MANAGER: 'operations-manager',
  SUPERVISOR: 'supervisor',
  TECHNICIAN: 'technician',
};

const people: DemoUser[] = [
  {
    email: 'admin@abc-facilities.example',
    name: 'Anika Shah',
    role: 'ORG_ADMIN',
    jobTitle: 'Director of Operations',
  },
  {
    email: 'manager@abc-facilities.example',
    name: 'Rohan Mehta',
    role: 'OPERATIONS_MANAGER',
    jobTitle: 'Operations Manager',
  },
  {
    email: 'supervisor.pune@abc-facilities.example',
    name: 'Priya Kulkarni',
    role: 'SUPERVISOR',
    jobTitle: 'Pune Site Supervisor',
  },
  {
    email: 'supervisor.mumbai@abc-facilities.example',
    name: 'Imran Qureshi',
    role: 'SUPERVISOR',
    jobTitle: 'Mumbai Site Supervisor',
  },
  {
    email: 'tech.electrical.1@abc-facilities.example',
    name: 'Suresh Patil',
    role: 'TECHNICIAN',
    jobTitle: 'Electrical Technician',
  },
  {
    email: 'tech.electrical.2@abc-facilities.example',
    name: 'Neha Jadhav',
    role: 'TECHNICIAN',
    jobTitle: 'Electrical Technician',
  },
  {
    email: 'tech.mechanical.1@abc-facilities.example',
    name: 'Vikram Deshmukh',
    role: 'TECHNICIAN',
    jobTitle: 'Mechanical Technician',
  },
  {
    email: 'tech.mechanical.2@abc-facilities.example',
    name: 'Aisha Khan',
    role: 'TECHNICIAN',
    jobTitle: 'Mechanical Technician',
  },
  {
    email: 'tech.network.1@abc-facilities.example',
    name: 'Arjun Nair',
    role: 'TECHNICIAN',
    jobTitle: 'Network Technician',
  },
  {
    email: 'tech.network.2@abc-facilities.example',
    name: 'Kavita More',
    role: 'TECHNICIAN',
    jobTitle: 'Network Technician',
  },
];

async function main(): Promise<void> {
  const password = process.env.DEMO_PASSWORD || 'Opsbridge-demo-2026';
  const passwordHash = await hashPassword(password);

  const organization = await prisma.organization.upsert({
    where: { slug: 'abc-facilities-management' },
    update: {
      name: 'ABC Facilities Management',
      industry: 'Facility management',
      timezone: 'Asia/Kolkata',
    },
    create: {
      name: 'ABC Facilities Management',
      slug: 'abc-facilities-management',
      industry: 'Facility management',
      timezone: 'Asia/Kolkata',
    },
  });

  for (const [baseRole, template] of Object.entries(roleTemplateDefaults) as Array<
    [MemberRole, (typeof roleTemplateDefaults)[MemberRole]]
  >) {
    await prisma.organizationRole.upsert({
      where: {
        organizationId_slug: { organizationId: organization.id, slug: template.slug },
      },
      update: {
        name: template.name,
        permissions: template.permissions,
        dataScope: template.dataScope,
        system: true,
      },
      create: {
        organizationId: organization.id,
        name: template.name,
        slug: template.slug,
        baseRole,
        dataScope: template.dataScope,
        permissions: template.permissions,
        system: true,
      },
    });
  }

  const systemRoles = await prisma.organizationRole.findMany({
    where: { organizationId: organization.id, system: true },
  });
  const roleBySlug = new Map(systemRoles.map((role) => [role.slug, role]));

  for (const person of people) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: person.name,
            jobTitle: person.jobTitle,
            passwordHash,
          },
        })
      : await prisma.user.create({
          data: {
            ...newUserIdentity(),
            email: person.email,
            name: person.name,
            jobTitle: person.jobTitle,
            passwordHash,
          },
        });

    const orgRole = roleBySlug.get(roleSlug[person.role]);
    if (!orgRole) {
      throw new Error(`Missing system role for ${person.role}`);
    }

    await prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: { role: person.role, orgRoleId: orgRole.id, active: true },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: person.role,
        orgRoleId: orgRole.id,
      },
    });
  }

  const users = await prisma.user.findMany({
    where: { email: { in: people.map((person) => person.email) } },
  });
  const byEmail = new Map(users.map((user) => [user.email, user]));
  const sites = [
    ['Mumbai Corporate Office', 'Nariman Point, Mumbai'],
    ['Pune Manufacturing Plant', 'Hinjewadi, Pune'],
    ['Nashik Distribution Center', 'Satpur, Nashik'],
  ] as const;
  const siteRows = [];
  for (const [name, address] of sites) {
    siteRows.push(
      await prisma.site.upsert({
        where: { organizationId_name: { organizationId: organization.id, name } },
        update: { address },
        create: { organizationId: organization.id, name, address, timezone: 'Asia/Kolkata' },
      }),
    );
  }
  const teamNames = ['Electrical Maintenance', 'Mechanical Maintenance', 'Network Operations'];
  for (const [index, name] of teamNames.entries()) {
    const team = await prisma.team.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { siteId: siteRows[index]?.id },
      create: { organizationId: organization.id, name, siteId: siteRows[index]?.id },
    });
    const tech = byEmail.get(
      index === 0
        ? 'tech.electrical.1@abc-facilities.example'
        : index === 1
          ? 'tech.mechanical.1@abc-facilities.example'
          : 'tech.network.1@abc-facilities.example',
    );
    if (tech) {
      await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: tech.id } },
        update: {},
        create: { teamId: team.id, userId: tech.id },
      });
      await prisma.workforceProfile.upsert({
        where: { organizationId_userId: { organizationId: organization.id, userId: tech.id } },
        update: { availability: 'AVAILABLE', siteId: siteRows[index]?.id },
        create: {
          organizationId: organization.id,
          userId: tech.id,
          availability: 'AVAILABLE',
          siteId: siteRows[index]?.id,
        },
      });
    }
  }
  const admin = byEmail.get('admin@abc-facilities.example');
  const electrical = await prisma.team.findFirst({
    where: { organizationId: organization.id, name: 'Electrical Maintenance' },
  });
  const assignee = byEmail.get('tech.electrical.1@abc-facilities.example');
  if (admin && siteRows[1] && electrical && assignee) {
    const incident = await prisma.incident.upsert({
      where: { organizationId_number: { organizationId: organization.id, number: 'INC-2026-0001' } },
      update: {},
      create: {
        organizationId: organization.id,
        number: 'INC-2026-0001',
        sequence: 1,
        title: 'Electrical panel overheating',
        description: 'The main electrical panel in the Pune plant is running hot during the afternoon shift.',
        category: 'ELECTRICAL',
        priority: 'CRITICAL',
        status: 'ASSIGNED',
        siteId: siteRows[1].id,
        location: 'Building A, ground floor',
        equipment: 'Main distribution panel MDP-2',
        teamId: electrical.id,
        assigneeId: assignee.id,
        createdById: admin.id,
        channelSetup: 'PENDING',
      },
    });
    await prisma.channelMapping.upsert({
      where: { channelId: 'inc2026000001' },
      update: {},
      create: {
        organizationId: organization.id,
        kind: 'INCIDENT',
        channelId: 'inc2026000001',
        name: incident.title.slice(0, 64),
        incidentId: incident.id,
        setupStatus: 'PENDING',
        lastError: 'Nexconn is not configured',
      },
    });
  }
  await prisma.escalationPolicy.upsert({
    where: { organizationId: organization.id },
    update: { criticalMinutes: 5, highMinutes: 15, mediumMinutes: 30 },
    create: { organizationId: organization.id, criticalMinutes: 5, highMinutes: 15, mediumMinutes: 30 },
  });

  console.log('Seeded ABC Facilities Management');
  console.log(`Demo password: ${password}`);
  for (const person of people) {
    console.log(`${person.role}\t${person.email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

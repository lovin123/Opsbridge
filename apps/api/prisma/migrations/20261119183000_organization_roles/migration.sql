-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ORG', 'SITE', 'ASSIGNED');

-- CreateTable
CREATE TABLE "OrganizationRole" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseRole" "MemberRole" NOT NULL,
    "dataScope" "DataScope" NOT NULL,
    "permissions" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationRole_organizationId_slug_key" ON "OrganizationRole"("organizationId", "slug");
CREATE INDEX "OrganizationRole_organizationId_system_idx" ON "OrganizationRole"("organizationId", "system");

ALTER TABLE "OrganizationRole" ADD CONSTRAINT "OrganizationRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed system roles for every organization
INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "slug", "baseRole", "dataScope", "permissions", "system", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Organization admin', 'org-admin', 'ORG_ADMIN', 'ORG',
  ARRAY[
    'org.settings.manage','org.members.manage','org.roles.manage',
    'sites.manage','sites.view','teams.manage','teams.view','workforce.view',
    'shifts.manage','shifts.view','handovers.draft','handovers.publish','handovers.view',
    'incidents.create','incidents.assign','incidents.update_any','incidents.view',
    'analytics.view','communications.view'
  ]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o;

INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "slug", "baseRole", "dataScope", "permissions", "system", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Operations manager', 'operations-manager', 'OPERATIONS_MANAGER', 'ORG',
  ARRAY[
    'org.settings.manage',
    'sites.manage','sites.view','teams.manage','teams.view','workforce.view',
    'shifts.manage','shifts.view','handovers.draft','handovers.publish','handovers.view',
    'incidents.create','incidents.assign','incidents.update_any','incidents.view',
    'analytics.view','communications.view'
  ]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o;

INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "slug", "baseRole", "dataScope", "permissions", "system", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Supervisor', 'supervisor', 'SUPERVISOR', 'SITE',
  ARRAY[
    'sites.view','teams.view','workforce.view',
    'shifts.manage','shifts.view','handovers.draft','handovers.publish','handovers.view',
    'incidents.create','incidents.assign','incidents.update_any','incidents.view',
    'analytics.view','communications.view'
  ]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o;

INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "slug", "baseRole", "dataScope", "permissions", "system", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", 'Technician', 'technician', 'TECHNICIAN', 'ASSIGNED',
  ARRAY[
    'sites.view','teams.view','shifts.view','handovers.view','incidents.view','communications.view'
  ]::TEXT[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o;

-- Membership.orgRoleId
ALTER TABLE "Membership" ADD COLUMN "orgRoleId" UUID;

UPDATE "Membership" m
SET "orgRoleId" = r."id"
FROM "OrganizationRole" r
WHERE r."organizationId" = m."organizationId"
  AND r."system" = true
  AND (
    (m."role" = 'ORG_ADMIN' AND r."slug" = 'org-admin') OR
    (m."role" = 'OPERATIONS_MANAGER' AND r."slug" = 'operations-manager') OR
    (m."role" = 'SUPERVISOR' AND r."slug" = 'supervisor') OR
    (m."role" = 'TECHNICIAN' AND r."slug" = 'technician')
  );

ALTER TABLE "Membership" ALTER COLUMN "orgRoleId" SET NOT NULL;
CREATE INDEX "Membership_orgRoleId_idx" ON "Membership"("orgRoleId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgRoleId_fkey" FOREIGN KEY ("orgRoleId") REFERENCES "OrganizationRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invitation.orgRoleId
ALTER TABLE "Invitation" ADD COLUMN "orgRoleId" UUID;

UPDATE "Invitation" i
SET "orgRoleId" = r."id"
FROM "OrganizationRole" r
WHERE r."organizationId" = i."organizationId"
  AND r."system" = true
  AND (
    (i."role" = 'ORG_ADMIN' AND r."slug" = 'org-admin') OR
    (i."role" = 'OPERATIONS_MANAGER' AND r."slug" = 'operations-manager') OR
    (i."role" = 'SUPERVISOR' AND r."slug" = 'supervisor') OR
    (i."role" = 'TECHNICIAN' AND r."slug" = 'technician')
  );

ALTER TABLE "Invitation" ALTER COLUMN "orgRoleId" SET NOT NULL;
CREATE INDEX "Invitation_orgRoleId_idx" ON "Invitation"("orgRoleId");
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgRoleId_fkey" FOREIGN KEY ("orgRoleId") REFERENCES "OrganizationRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

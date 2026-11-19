-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'BUSY', 'ON_BREAK', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('ELECTRICAL', 'MECHANICAL', 'NETWORK', 'EQUIPMENT_FAILURE', 'MAINTENANCE', 'SAFETY_OBSERVATION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('INCIDENT', 'TEAM', 'SITE', 'SHIFT');

-- CreateEnum
CREATE TYPE "ChannelSetupStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('INCIDENT_PHOTO', 'EQUIPMENT', 'RESOLUTION_EVIDENCE', 'DOCUMENT', 'PROFILE', 'TEAM_LOGO', 'ORG_LOGO');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ASSIGNMENT', 'REASSIGNMENT', 'MESSAGE', 'ESCALATION', 'RESOLUTION', 'HANDOVER');

-- CreateEnum
CREATE TYPE "AiSnapshotStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'INCIDENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INCIDENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_ATTACHED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_CONTEXT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'HANDOVER_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'ESCALATION_FIRED';

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "userId" UUID NOT NULL,
    "skillId" UUID NOT NULL,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("userId","skillId")
);

-- CreateTable
CREATE TABLE "WorkforceProfile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "siteId" UUID,
    "availability" "Availability" NOT NULL DEFAULT 'AVAILABLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "supervisorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "shiftId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("shiftId","userId")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "priority" "IncidentPriority" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "siteId" UUID NOT NULL,
    "location" TEXT,
    "equipment" TEXT,
    "teamId" UUID,
    "assigneeId" UUID,
    "dueAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "channelSetup" "ChannelSetupStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "actorId" UUID,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMapping" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "ChannelKind" NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setupStatus" "ChannelSetupStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "incidentId" UUID,
    "teamId" UUID,
    "siteId" UUID,
    "shiftId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageIndex" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenceState" (
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "assetId" TEXT,
    "resourceType" TEXT NOT NULL,
    "format" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "purpose" "MediaPurpose" NOT NULL,
    "incidentId" UUID,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadGrant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "incidentId" UUID,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "incidentId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "organizationId" UUID NOT NULL,
    "criticalMinutes" INTEGER NOT NULL DEFAULT 0,
    "highMinutes" INTEGER NOT NULL DEFAULT 15,
    "mediumMinutes" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "priority" "IncidentPriority" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiContextSnapshot" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AiSnapshotStatus" NOT NULL,
    "watermarkEventAt" TIMESTAMP(3),
    "watermarkMessageId" TEXT,
    "payload" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationBatchSummary" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fromMessageId" TEXT NOT NULL,
    "toMessageId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "sourceMessageIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationBatchSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAssistantSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAssistantMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contextVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftHandover" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shiftId" UUID,
    "status" "HandoverStatus" NOT NULL DEFAULT 'DRAFT',
    "report" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_organizationId_idx" ON "Site"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_organizationId_name_key" ON "Site"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_organizationId_name_key" ON "Skill"("organizationId", "name");

-- CreateIndex
CREATE INDEX "WorkforceProfile_organizationId_availability_idx" ON "WorkforceProfile"("organizationId", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceProfile_organizationId_userId_key" ON "WorkforceProfile"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Shift_organizationId_startsAt_idx" ON "Shift"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "Incident_organizationId_status_priority_idx" ON "Incident"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "Incident_assigneeId_idx" ON "Incident"("assigneeId");

-- CreateIndex
CREATE INDEX "Incident_siteId_idx" ON "Incident"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_organizationId_number_key" ON "Incident"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_organizationId_sequence_key" ON "Incident"("organizationId", "sequence");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_channelId_key" ON "ChannelMapping"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_incidentId_key" ON "ChannelMapping"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_teamId_key" ON "ChannelMapping"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_siteId_key" ON "ChannelMapping"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_shiftId_key" ON "ChannelMapping"("shiftId");

-- CreateIndex
CREATE INDEX "ChannelMapping_organizationId_kind_idx" ON "ChannelMapping"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MessageIndex_messageId_key" ON "MessageIndex"("messageId");

-- CreateIndex
CREATE INDEX "MessageIndex_channelId_sentAt_idx" ON "MessageIndex"("channelId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_publicId_key" ON "MediaAsset"("publicId");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_incidentId_idx" ON "MediaAsset"("organizationId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadGrant_publicId_key" ON "UploadGrant"("publicId");

-- CreateIndex
CREATE INDEX "UploadGrant_organizationId_expiresAt_idx" ON "UploadGrant"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationEvent_dedupeKey_key" ON "EscalationEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "EscalationEvent_incidentId_idx" ON "EscalationEvent"("incidentId");

-- CreateIndex
CREATE INDEX "AiContextSnapshot_incidentId_createdAt_idx" ON "AiContextSnapshot"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiContextSnapshot_incidentId_version_key" ON "AiContextSnapshot"("incidentId", "version");

-- CreateIndex
CREATE INDEX "ConversationBatchSummary_incidentId_createdAt_idx" ON "ConversationBatchSummary"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAssistantSession_incidentId_userId_idx" ON "AiAssistantSession"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "AiAssistantMessage_sessionId_createdAt_idx" ON "AiAssistantMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftHandover_organizationId_createdAt_idx" ON "ShiftHandover"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceProfile" ADD CONSTRAINT "WorkforceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceProfile" ADD CONSTRAINT "WorkforceProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceProfile" ADD CONSTRAINT "WorkforceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMapping" ADD CONSTRAINT "ChannelMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMapping" ADD CONSTRAINT "ChannelMapping_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMapping" ADD CONSTRAINT "ChannelMapping_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMapping" ADD CONSTRAINT "ChannelMapping_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMapping" ADD CONSTRAINT "ChannelMapping_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIndex" ADD CONSTRAINT "MessageIndex_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceState" ADD CONSTRAINT "PresenceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadGrant" ADD CONSTRAINT "UploadGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContextSnapshot" ADD CONSTRAINT "AiContextSnapshot_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationBatchSummary" ADD CONSTRAINT "ConversationBatchSummary_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantSession" ADD CONSTRAINT "AiAssistantSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantSession" ADD CONSTRAINT "AiAssistantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantSession" ADD CONSTRAINT "AiAssistantSession_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAssistantMessage" ADD CONSTRAINT "AiAssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiAssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftHandover" ADD CONSTRAINT "ShiftHandover_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftHandover" ADD CONSTRAINT "ShiftHandover_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

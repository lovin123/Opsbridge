import { z } from 'zod';

export const incidentCategories = [
  'ELECTRICAL',
  'MECHANICAL',
  'NETWORK',
  'EQUIPMENT_FAILURE',
  'MAINTENANCE',
  'SAFETY_OBSERVATION',
  'OTHER',
] as const;

export const incidentPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const incidentStatuses = [
  'OPEN',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
] as const;
export const availabilityValues = ['AVAILABLE', 'BUSY', 'ON_BREAK', 'OFF_DUTY'] as const;

export const incidentCategorySchema = z.enum(incidentCategories);
export const incidentPrioritySchema = z.enum(incidentPriorities);
export const incidentStatusSchema = z.enum(incidentStatuses);
export const availabilitySchema = z.enum(availabilityValues);

export type IncidentCategory = z.infer<typeof incidentCategorySchema>;
export type IncidentPriority = z.infer<typeof incidentPrioritySchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type Availability = z.infer<typeof availabilitySchema>;

export const createSiteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  siteId: z.string().uuid().optional(),
  memberIds: z.array(z.string().uuid()).max(30).optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  memberIds: z.array(z.string().uuid()).max(30),
});

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour time)');

export const createShiftSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  daysOfWeek: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'Select at least one day')
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Days must be unique'),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  supervisorId: z.string().uuid().optional(),
  memberIds: z.array(z.string().uuid()).max(30).default([]),
});

export const updateAvailabilitySchema = z.object({
  availability: availabilitySchema,
  siteId: z.string().uuid().nullable().optional(),
  skillNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(4000),
  category: incidentCategorySchema,
  priority: incidentPrioritySchema,
  siteId: z.string().uuid(),
  location: z.string().trim().max(160).optional(),
  equipment: z.string().trim().max(160).optional(),
  teamId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
});

export const updateIncidentStatusSchema = z.object({
  status: incidentStatusSchema,
  resolutionNotes: z.string().trim().max(4000).optional(),
});

export const assignIncidentSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable().optional(),
});

export const askAssistantSchema = z.object({
  question: z.string().trim().min(3).max(2000),
});

export const escalationPolicySchema = z.object({
  // 0 means escalate immediately for that priority.
  criticalMinutes: z.number().int().min(0).max(1440),
  highMinutes: z.number().int().min(0).max(1440),
  mediumMinutes: z.number().int().min(0).max(1440),
});

export const mediaPurposeSchema = z.enum([
  'INCIDENT_PHOTO',
  'EQUIPMENT',
  'RESOLUTION_EVIDENCE',
  'DOCUMENT',
  'PROFILE',
  'TEAM_LOGO',
  'ORG_LOGO',
]);

export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;

export const signUploadSchema = z.object({
  purpose: mediaPurposeSchema,
  filename: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(120),
  bytes: z.number().int().positive().max(50 * 1024 * 1024),
  incidentId: z.string().uuid().optional(),
});

export const confirmUploadSchema = z.object({
  grantId: z.string().uuid(),
  publicId: z.string().trim().min(1).max(300),
  assetId: z.string().min(1).max(200).optional(),
  filename: z.string().trim().min(1).max(180).optional(),
  format: z.string().max(20).optional(),
  resourceType: z.enum(['image', 'video', 'raw']),
  mimeType: z.string().trim().min(3).max(120).optional(),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
});

export const incidentIntelligenceSchema = z.object({
  problemSummary: z.string(),
  probableCauses: z.array(
    z.object({
      cause: z.string(),
      reason: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
  recommendedActions: z.array(z.object({ action: z.string(), reason: z.string() })),
  requiredSkills: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high']),
  missingInformation: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export const classificationSuggestionSchema = z.object({
  category: incidentCategorySchema,
  priority: incidentPrioritySchema,
  recommendedTeam: z.string().nullable(),
  requiredSkills: z.array(z.string()),
  potentialSlaMinutes: z.number().int().nullable(),
  rationale: z.string(),
});

export const incidentMemorySchema = z.object({
  problemSummary: z.string(),
  findings: z.array(z.string()),
  actionsPerformed: z.array(z.string()),
  pendingActions: z.array(z.string()),
  decisions: z.array(z.string()),
  currentStatus: z.string(),
});

export const assistantAnswerSchema = z.object({
  answer: z.string(),
  evidence: z.array(z.string()),
  hypotheses: z.array(z.string()),
  missingInformation: z.array(z.string()),
});

export const handoverReportSchema = z.object({
  narrative: z.string(),
  criticalIssues: z.array(z.string()),
  pendingActions: z.array(z.object({ action: z.string(), owner: z.string() })),
  priorities: z.array(z.string()),
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentStatusInput = z.infer<typeof updateIncidentStatusSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
export type AskAssistantInput = z.infer<typeof askAssistantSchema>;
export type EscalationPolicyInput = z.infer<typeof escalationPolicySchema>;
export type IncidentIntelligence = z.infer<typeof incidentIntelligenceSchema>;
export type IncidentMemory = z.infer<typeof incidentMemorySchema>;
export type HandoverReport = z.infer<typeof handoverReportSchema>;

const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['ACCEPTED', 'OPEN'],
  ACCEPTED: ['IN_PROGRESS', 'ON_HOLD'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED'],
  ON_HOLD: ['IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  return allowedTransitions[from];
}

export function incidentChannelId(year: number, sequence: number): string {
  return `inc${year}${String(sequence).padStart(6, '0')}`;
}

export function incidentNumber(year: number, sequence: number): string {
  return `INC-${year}-${String(sequence).padStart(4, '0')}`;
}

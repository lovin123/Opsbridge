-- Convert one-off shift datetimes into recurring weekly patterns.
ALTER TABLE "Shift" ADD COLUMN "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Shift" ADD COLUMN "startTime" TEXT NOT NULL DEFAULT '00:00';
ALTER TABLE "Shift" ADD COLUMN "endTime" TEXT NOT NULL DEFAULT '00:00';

UPDATE "Shift"
SET
  "daysOfWeek" = ARRAY[
    CASE EXTRACT(ISODOW FROM "startsAt" AT TIME ZONE 'UTC')::INTEGER
      WHEN 1 THEN 1
      WHEN 2 THEN 2
      WHEN 3 THEN 3
      WHEN 4 THEN 4
      WHEN 5 THEN 5
      WHEN 6 THEN 6
      WHEN 7 THEN 7
      ELSE 1
    END
  ],
  "startTime" = to_char("startsAt" AT TIME ZONE 'UTC', 'HH24:MI'),
  "endTime" = to_char("endsAt" AT TIME ZONE 'UTC', 'HH24:MI');

DROP INDEX IF EXISTS "Shift_organizationId_startsAt_idx";

ALTER TABLE "Shift" DROP COLUMN "startsAt";
ALTER TABLE "Shift" DROP COLUMN "endsAt";

ALTER TABLE "Shift" ALTER COLUMN "daysOfWeek" DROP DEFAULT;
ALTER TABLE "Shift" ALTER COLUMN "startTime" DROP DEFAULT;
ALTER TABLE "Shift" ALTER COLUMN "endTime" DROP DEFAULT;

CREATE INDEX "Shift_organizationId_siteId_idx" ON "Shift"("organizationId", "siteId");

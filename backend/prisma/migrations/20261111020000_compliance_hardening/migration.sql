-- Phase 7: compliance hardening.

-- Anonymization markers (retention expiry / erasure request).
ALTER TABLE "candidates" ADD COLUMN "anonymized_at" TIMESTAMP(3);
ALTER TABLE "candidate_sessions" ADD COLUMN "anonymized_at" TIMESTAMP(3);

-- OTP verify-attempt counter (lockout after too many wrong codes).
ALTER TABLE "login_otps" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Basic proctoring signals (tab hidden / fullscreen exit).
CREATE TABLE "proctoring_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proctoring_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proctoring_events_session_id_idx" ON "proctoring_events"("session_id");

ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill retention dates for already-completed sessions (DATA_RETENTION_DAYS
-- default of 180). Sessions without one are also covered by the job's
-- fallback rule, so this is a convenience, not a requirement.
UPDATE "candidate_sessions"
SET "data_retention_until" = "completed_at" + INTERVAL '180 days'
WHERE "completed_at" IS NOT NULL AND "data_retention_until" IS NULL;

-- Append-only audit log: block UPDATE, DELETE and TRUNCATE at the database
-- level. A database owner can still drop these triggers, so this is
-- tamper-resistant, not tamper-proof — see docs/COMPLIANCE.md.
CREATE OR REPLACE FUNCTION audit_log_reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION audit_log_reject_modification();

CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON "audit_log"
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_modification();

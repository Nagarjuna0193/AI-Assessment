-- Phase 4.6: split `interviews` into `interview_templates` (the JD/role,
-- shared across candidates) + `candidate_sessions` (one invited candidate's
-- attempt). See docs/DECISIONS.md for every assumption made in the
-- best-effort data migration below (this is throwaway pilot data, so the
-- migration favors simplicity over completeness).

-- CreateEnum
CREATE TYPE "QuestionMode" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "interview_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "job_id" TEXT,
    "job_description_text" TEXT NOT NULL,
    "question_mode" "QuestionMode" NOT NULL DEFAULT 'AI',
    "manual_questions" JSONB,
    "created_by_org_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_sessions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invite_token" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'INVITED',
    "mode" "SessionMode" NOT NULL DEFAULT 'TEXT',
    "resume_file_ref" TEXT,
    "resume_text" TEXT,
    "resume_jd_score" INTEGER,
    "resume_jd_rationale" TEXT,
    "consent_record_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "data_retention_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_sessions_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add new FK columns alongside the old ones (nullable for now,
-- backfilled below, tightened to NOT NULL once populated).
ALTER TABLE "questions" ADD COLUMN "session_id" TEXT;
ALTER TABLE "responses" ADD COLUMN "session_id" TEXT;
ALTER TABLE "evaluations" ADD COLUMN "session_id" TEXT;
ALTER TABLE "credit_transactions" ADD COLUMN "session_id" TEXT;

-- ============================================================
-- Best-effort data migration (see docs/DECISIONS.md for the full
-- rationale). Every existing `interviews` row becomes exactly one
-- interview_templates row + one candidate_sessions row — no deduplication
-- by role/JD, since this is throwaway pilot data, not a real migration.
-- ============================================================

-- Interviews with no org_id (created before Phase 4.5) have nothing valid
-- to set candidate_sessions.org_id to (NOT NULL), so they are NOT migrated.
-- Their child rows are dropped as part of this migration — acceptable data
-- loss for throwaway pilot data predating org association entirely.
CREATE TEMP TABLE legacy_interview_template_map AS
SELECT i.id AS interview_id, gen_random_uuid() AS template_id
FROM "interviews" i
WHERE i.org_id IS NOT NULL;

INSERT INTO "interview_templates"
  (id, org_id, role_name, job_id, job_description_text, question_mode, manual_questions, created_by_org_user_id, created_at, updated_at)
SELECT
  m.template_id,
  i.org_id,
  COALESCE(i.job_title, 'Untitled role'),
  NULL,
  i.job_description_text,
  'AI',
  NULL,
  NULL,
  i.created_at,
  i.created_at
FROM "interviews" i
JOIN legacy_interview_template_map m ON m.interview_id = i.id;

-- candidate_sessions.id reuses the original interview's id directly (both
-- are already-unique UUIDs, and `interviews` is being dropped in this same
-- migration) so questions/responses/evaluations can be repointed by a
-- simple value copy below, with no separate id-mapping table needed.
-- consent_record_id is left NULL for migrated rows: a candidate could have
-- had multiple interviews against the same consent record, and
-- candidate_sessions.consent_record_id is UNIQUE, so guessing one would
-- risk a constraint violation for no real benefit — the DPDP consent trail
-- is unaffected either way (consent_records.candidate_id is untouched).
INSERT INTO "candidate_sessions"
  (id, template_id, org_id, candidate_name, email, invite_token, status, mode,
   resume_file_ref, resume_text, resume_jd_score, resume_jd_rationale, consent_record_id,
   started_at, completed_at, data_retention_until, created_at, updated_at)
SELECT
  i.id,
  m.template_id,
  i.org_id,
  c.full_name,
  c.email,
  i.id::text,
  (CASE i.status::text
     WHEN 'SCHEDULED' THEN 'INVITED'
     WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
     WHEN 'COMPLETED' THEN 'COMPLETED'
     ELSE 'CANCELLED'
   END)::"SessionStatus",
  i.mode::text::"SessionMode",
  NULL,
  c.resume_text,
  NULL,
  NULL,
  NULL,
  i.started_at,
  i.completed_at,
  i.data_retention_until,
  i.created_at,
  i.updated_at
FROM "interviews" i
JOIN legacy_interview_template_map m ON m.interview_id = i.id
JOIN "candidates" c ON c.id = i.candidate_id;

-- Orphan cleanup: children of un-migrated (null-org) interviews have no
-- valid session to attach to (candidate_sessions.org_id is NOT NULL) —
-- drop them rather than leaving dangling data. Responses before questions
-- (FK order); evaluations have no further dependents.
DELETE FROM "responses" WHERE "interview_id" IN (SELECT id FROM "interviews" WHERE org_id IS NULL);
DELETE FROM "evaluations" WHERE "interview_id" IN (SELECT id FROM "interviews" WHERE org_id IS NULL);
DELETE FROM "questions" WHERE "interview_id" IN (SELECT id FROM "interviews" WHERE org_id IS NULL);

-- Backfill session_id for everything that survived the orphan cleanup
-- (session id == original interview id, per the choice above).
UPDATE "questions" SET "session_id" = "interview_id" WHERE "interview_id" IS NOT NULL;
UPDATE "responses" SET "session_id" = "interview_id" WHERE "interview_id" IS NOT NULL;
UPDATE "evaluations" SET "session_id" = "interview_id" WHERE "interview_id" IS NOT NULL;
UPDATE "credit_transactions" SET "session_id" = "interview_id" WHERE "interview_id" IS NOT NULL;

DROP TABLE legacy_interview_template_map;

-- ============================================================
-- End data migration — now drop the old interview-based schema.
-- ============================================================

-- DropForeignKey
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_interview_id_fkey";
ALTER TABLE "credit_transactions" DROP CONSTRAINT "credit_transactions_interview_id_fkey";
ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_interview_id_fkey";
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_candidate_id_fkey";
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_org_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_interview_id_fkey";
ALTER TABLE "responses" DROP CONSTRAINT "responses_interview_id_fkey";

-- DropIndex
-- (responses_question_id_idx and audit_log_entity_type_entity_id_idx are
-- kept as-is — they're unrelated to this migration and still useful.)
DROP INDEX "consent_records_interview_id_idx";
DROP INDEX "credit_transactions_interview_id_key";
DROP INDEX "evaluations_interview_id_idx";
DROP INDEX "questions_interview_id_idx";
DROP INDEX "responses_interview_id_idx";

-- AlterTable
ALTER TABLE "consent_records" DROP COLUMN "interview_id";
ALTER TABLE "credit_transactions" DROP COLUMN "interview_id";
ALTER TABLE "evaluations" DROP COLUMN "interview_id";
ALTER TABLE "questions" DROP COLUMN "interview_id";
ALTER TABLE "responses" DROP COLUMN "interview_id";

-- Now that every surviving row has a session_id, tighten to NOT NULL where
-- the model requires it (credit_transactions.session_id stays nullable —
-- grants have no session).
ALTER TABLE "questions" ALTER COLUMN "session_id" SET NOT NULL;
ALTER TABLE "responses" ALTER COLUMN "session_id" SET NOT NULL;
ALTER TABLE "evaluations" ALTER COLUMN "session_id" SET NOT NULL;

-- DropTable
DROP TABLE "interviews";

-- DropEnum
DROP TYPE "InterviewMode";
DROP TYPE "InterviewStatus";

-- CreateIndex
CREATE INDEX "interview_templates_org_id_idx" ON "interview_templates"("org_id");
CREATE UNIQUE INDEX "candidate_sessions_invite_token_key" ON "candidate_sessions"("invite_token");
CREATE UNIQUE INDEX "candidate_sessions_consent_record_id_key" ON "candidate_sessions"("consent_record_id");
CREATE INDEX "candidate_sessions_org_id_idx" ON "candidate_sessions"("org_id");
CREATE INDEX "candidate_sessions_template_id_idx" ON "candidate_sessions"("template_id");
CREATE UNIQUE INDEX "credit_transactions_session_id_key" ON "credit_transactions"("session_id");
CREATE INDEX "evaluations_session_id_idx" ON "evaluations"("session_id");
CREATE INDEX "questions_session_id_idx" ON "questions"("session_id");
CREATE INDEX "responses_session_id_idx" ON "responses"("session_id");

-- AddForeignKey
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_created_by_org_user_id_fkey" FOREIGN KEY ("created_by_org_user_id") REFERENCES "org_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidate_sessions" ADD CONSTRAINT "candidate_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "interview_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_sessions" ADD CONSTRAINT "candidate_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_sessions" ADD CONSTRAINT "candidate_sessions_consent_record_id_fkey" FOREIGN KEY ("consent_record_id") REFERENCES "consent_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "responses" ADD CONSTRAINT "responses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

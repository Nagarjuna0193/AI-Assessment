-- Phase 7.6: conversational (adaptive) AI-mode interviews.
ALTER TABLE "candidate_sessions" ADD COLUMN "interview_plan" JSONB;

ALTER TABLE "questions" ADD COLUMN "lead_in" TEXT;
ALTER TABLE "questions" ADD COLUMN "kind" TEXT;
ALTER TABLE "questions" ADD COLUMN "topic" TEXT;
ALTER TABLE "questions" ADD COLUMN "rationale" TEXT;

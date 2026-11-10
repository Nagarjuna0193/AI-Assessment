-- CreateEnum
CREATE TYPE "HumanReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "human_review_requests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "evaluation_id" TEXT,
    "reason" TEXT NOT NULL,
    "status" "HumanReviewStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "resolution_notes" TEXT,
    "candidate_response" TEXT,
    "resolved_by_org_user_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "human_review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "human_review_requests_session_id_idx" ON "human_review_requests"("session_id");

-- CreateIndex
CREATE INDEX "human_review_requests_status_idx" ON "human_review_requests"("status");

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "candidate_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_resolved_by_org_user_id_fkey" FOREIGN KEY ("resolved_by_org_user_id") REFERENCES "org_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


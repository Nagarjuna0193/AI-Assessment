-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "concerns" JSONB,
ADD COLUMN     "prompt_version" TEXT,
ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "strengths" JSONB;


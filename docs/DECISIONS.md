# Decisions & Assumptions Log

Every assumption made that isn't explicitly stated in `CLAUDE.md` or by the
user, logged here with a one-line reason. Newest entries at the bottom.

| Date | Assumption/Decision | Reason |
|------|---------------------|--------|
| 2026-07-28 | Phase breakdown in `TODO.md` (Phase 0–8) is inferred from project scope in `CLAUDE.md`, since the full "prompt set" defining each phase wasn't provided verbatim. | Needed a concrete checklist to track progress against; phases follow the natural build order (setup -> backend/DB -> question gen -> text interview -> voice -> evaluation -> compliance hardening -> pilot deploy). Revise if the actual prompt set differs. |
| 2026-07-28 | Chose **Prisma** as the migration tool over `node-pg-migrate`. | Backend stack is Node.js/Express; Prisma gives a single-source-of-truth schema (`schema.prisma`), generates SQL migrations automatically, and has a typed client ready for when API routes are built in a later phase — fits the "keep it simple" pilot-scale approach better than hand-writing migrations with `node-pg-migrate`. |
| 2026-07-28 | The Phase 1 migration (`backend/prisma/migrations/20260728000000_init/migration.sql`) was authored by hand rather than generated via `prisma migrate dev`. | No live `DATABASE_URL` is available in this environment yet (Postgres instance not provisioned). SQL was written to match what Prisma would generate from `schema.prisma`; run `npx prisma migrate dev` against a real database in Phase 1's follow-up (or start of Phase 2) to confirm it applies cleanly and regenerate if Prisma's output differs. |
| 2026-07-28 | Row IDs use Prisma's app-generated `uuid()` default rather than a Postgres-native `gen_random_uuid()`. | Avoids requiring the `pgcrypto`/`uuid-ossp` extension on the managed Postgres instance (Supabase/Railway) — one less thing to provision at pilot scale. |
| 2026-07-28 | `evaluations` is one row per interview (not per response), with a `scorecard` JSON column for per-question/criterion detail rather than a separate table. | Matches the "structured feedback report" requirement in `CLAUDE.md` without adding a table before we know the report's real shape; simplest option for pilot scale. Revisit if per-criterion querying/reporting is needed later. |

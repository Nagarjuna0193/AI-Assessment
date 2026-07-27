# TODO / Phase Checklist

Current phase: **Phase 2 — core interview engine backend done**

See `docs/DECISIONS.md` for a note on how this phase breakdown was derived.

## Phase 0 — Requirements & Setup
- [x] Git repo initialized
- [x] Folder structure created (`docs/`, `backend/`, `frontend/`)
- [x] `README.md` written
- [x] `docs/ARCHITECTURE.md` written
- [x] `docs/COMPLIANCE.md` written (DPDP checklist)
- [x] `TODO.md` created
- [x] `.env.example` created

## Phase 1 — Data model
- [x] Postgres schema designed: candidates, interviews, questions,
      responses, evaluations, consent_records, audit_log
- [x] Migration tool chosen (Prisma) and documented in `docs/DECISIONS.md`
- [x] Migration files written (`backend/prisma/schema.prisma` +
      `backend/prisma/migrations/`)
- [x] Schema documented in `docs/ARCHITECTURE.md`
- [ ] Express (or Next.js API routes) scaffold — deferred to a later phase
- [ ] Basic auth (email/OTP or magic link) — deferred to a later phase

## Phase 2 — Core interview engine backend
- [x] `POST /api/consent` — records DPDP consent, upserts candidate
- [x] `POST /api/interviews` — accepts JD + resume text, enforces consent at
      the API level, calls Claude to generate a structured question set
- [x] `POST /api/interviews/:id/answers` — submits an answer, returns next
      question or end-of-interview signal
- [x] `POST /api/interviews/:id/evaluate` — calls Claude on the full
      transcript, returns/stores structured score + feedback
- [x] Every AI decision (question generation, evaluation) logged to
      `audit_log` per `docs/COMPLIANCE.md`
- [x] Jest + Supertest test suite (13 tests, mocked Prisma + Anthropic
      service) — `cd backend && npm test`
- [x] `docs/API.md` updated with all endpoints
- [ ] JD + resume **file** upload/parsing (currently plain text in the
      request body — file handling deferred)
- [ ] Auth middleware on these routes (still open from Phase 1)

## Phase 3 — Text interview flow
- [ ] Candidate-facing interview UI (text)
- [ ] Transcript capture in Postgres
- [ ] Audit logging wired in for all LLM calls

## Phase 4 — Voice interview flow
- [ ] STT/TTS provider decision (documented in `docs/DECISIONS.md`)
- [ ] Voice interview UI
- [ ] Voice transcript capture

## Phase 5 — Evaluation
- [ ] Claude-based transcript evaluation against JD
- [ ] Structured feedback report generation

## Phase 6 — Reporting & human review
- [ ] Feedback report UI (recruiter-facing)
- [ ] Human-review request path for candidates

## Phase 7 — Compliance hardening
- [ ] Full DPDP checklist in `docs/COMPLIANCE.md` reviewed and closed out
- [ ] Basic tab-switch/fullscreen detection
- [ ] Data retention/deletion process

## Phase 8 — Pilot deployment
- [ ] Deploy to Railway/Render
- [ ] Pilot run (50–100 interviews over ~3 months)
- [ ] Post-pilot review

## Parked for later
- AI avatar / video generation
- Multi-tenant billing
- Full proctoring (beyond tab-switch/fullscreen)
- ATS integrations
- EU AI Act-style mandatory bias audit tooling

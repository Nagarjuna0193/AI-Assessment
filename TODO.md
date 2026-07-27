# TODO / Phase Checklist

Current phase: **Phase 0 — done**

See `docs/DECISIONS.md` for a note on how this phase breakdown was derived.

## Phase 0 — Requirements & Setup
- [x] Git repo initialized
- [x] Folder structure created (`docs/`, `backend/`, `frontend/`)
- [x] `README.md` written
- [x] `docs/ARCHITECTURE.md` written
- [x] `docs/COMPLIANCE.md` written (DPDP checklist)
- [x] `TODO.md` created
- [x] `.env.example` created

## Phase 1 — Backend & DB scaffold
- [ ] Express (or Next.js API routes) scaffold
- [ ] Postgres schema: candidates, interviews, transcripts, consent log,
      audit log, feedback reports
- [ ] Basic auth (email/OTP or magic link)

## Phase 2 — Question generation
- [ ] JD + resume upload/parsing
- [ ] Claude-based question generation
- [ ] Consent capture wired in before any LLM call

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

# TODO / Phase Checklist

Current phase: **Phase 4 — voice input/output layer done**

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
- [x] `GET /api/interviews` and `GET /api/interviews/:id` (read-only, added
      in Phase 3 to support the reviewer dashboard and interview-screen
      refresh recovery — see `docs/DECISIONS.md`)

## Phase 3 — Text interview flow
- [x] Candidate-facing interview UI (text) — `frontend/pages/index.js`
      (consent + interview setup), `frontend/pages/interview/[id].js`,
      `frontend/pages/interview/[id]/complete.js`
- [x] Transcript capture in Postgres (via existing Phase 2
      `POST /api/interviews/:id/answers`)
- [x] Audit logging wired in for all LLM calls (unchanged from Phase 2 — no
      new LLM calls added in Phase 3)
- [x] Reviewer dashboard UI — `frontend/pages/dashboard/index.js` (list),
      `frontend/pages/dashboard/[id].js` (transcript + evaluation, manual
      "Run evaluation" trigger)
- [ ] Auth on the reviewer dashboard (currently open to anyone with the
      URL — same auth gap as the backend API; deferred with it)

## Phase 4 — Voice interview flow
- [x] STT/TTS provider decision (OpenAI Whisper + `tts-1`, single vendor;
      cost estimate documented in `docs/DECISIONS.md`)
- [x] Backend: `POST /api/interviews/:id/answers/transcribe` (STT, returns
      transcript only — does not persist, so the existing
      `POST /:id/answers` logic is untouched) and
      `GET /api/interviews/:id/questions/:questionId/audio` (TTS)
      — `backend/src/services/voiceService.js`,
      `backend/src/routes/interviewRoutes.js`
- [x] Voice interview UI — mode toggle (Text/Voice) + voice-specific consent
      on the setup screen (`frontend/pages/index.js`), mic recording (fills
      the existing answer textarea, falls back to typing on any failure) +
      "Play question" TTS playback on the interview screen
      (`frontend/components/VoiceControls.js`,
      `frontend/pages/interview/[id].js`)
- [x] Voice transcript capture — voice answers flow through the same
      transcript/response persistence as text (Phase 2's `POST /:id/answers`);
      raw audio is never stored, only the transcribed text (data
      minimization — see `docs/COMPLIANCE.md`)
- [x] `voice_recording` DPDP consent required (in addition to
      `data_processing`) before a voice interview can start, re-checked on
      every transcription call — `backend/src/config.js`,
      `docs/COMPLIANCE.md`
- [x] Jest tests for consent gating and both new voice endpoints
      (`backend/tests/voice.test.js`, additions to
      `backend/tests/interviews.test.js`) — 28/28 passing

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

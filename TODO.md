# TODO / Phase Checklist

Current phase: **Phase 4.7 — bulk invite done**

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

## Phase 4.5 — Enterprise auth & credits module
> Superseded in part by Phase 4.6 below: `interviews` no longer exists
> (split into `interview_templates` + `candidate_sessions`), credit
> deduction moved from interview/template creation to candidate_session
> (invite) creation, and `GET`/`POST /api/interviews/*` response shapes
> changed. This checklist is kept as a historical record of what Phase 4.5
> actually shipped — see Phase 4.6 and `docs/DECISIONS.md` for what changed.
- [x] Data model: `organizations` (name, credit_balance), `org_users`
      (email, org_id, role: admin/reviewer), `credit_transactions` (audit
      trail for grants/deductions), `interviews.org_id` FK — migration only
      (`backend/prisma/migrations/20260728010000_org_auth_credits/`)
- [x] Org_user auth: email/OTP, JWT session in an httpOnly cookie —
      `POST /api/auth/request-otp`, `POST /api/auth/verify-otp`,
      `POST /api/auth/logout`, `GET /api/auth/me`
      (`backend/src/routes/authRoutes.js`, `backend/src/services/authService.js`,
      `backend/src/services/emailService.js`)
- [x] Credits ledger: 1 credit deducted atomically per interview created
      (`POST /api/interviews` now requires `orgId`; `402 insufficient_credits`
      if the org has none — balance can never go negative)
      (`backend/src/services/creditService.js`)
- [x] Ops-only admin endpoints (separate `OPS_API_KEY`, not org_user auth —
      never self-serve): create organization, invite org_user, grant credits
      (`backend/src/routes/adminRoutes.js`)
- [x] `GET /api/interviews` and `GET /api/interviews/:id` now require
      org_user login and are scoped to the caller's own org — closes the
      open-to-anyone gap noted in Phase 2/3
- [x] New unauthenticated `GET /api/interviews/:id/progress` (minimal
      job title/mode/status + transcript) so the candidate interview
      screen's refresh-recovery still works now that `GET /:id` is
      auth-gated
- [x] Frontend: reviewer login page (`frontend/pages/login.js`), dashboard
      gated via `RequireAuth`, org name/credit balance + logout in the
      dashboard header; candidate setup screen now requires an `?org=`
      link param and sends it as `orgId`
- [x] Backend tests: `backend/tests/auth.test.js`, `backend/tests/credits.test.js`,
      plus org/credit updates to `backend/tests/interviews.test.js` — 54/54 passing
- [ ] Self-serve payment/checkout flow for credits — explicitly out of
      scope this phase (see "Parked for later")

## Phase 4.6 — Interview template / candidate session split
- [x] Migration: `interview_templates` + `candidate_sessions` tables;
      `questions`/`responses`/`evaluations`/`credit_transactions` re-keyed
      from `interview_id` to `session_id`; old `interviews` table and
      `InterviewMode`/`InterviewStatus` enums dropped after a best-effort
      data migration (throwaway pilot data — see `docs/DECISIONS.md` for
      every simplifying assumption)
      (`backend/prisma/migrations/20260728020000_interview_template_session_split/`)
- [x] Create Interview admin page/endpoint — org `ADMIN` role only, real gap
      before now: role name, job ID, JD text or file upload (PDF/DOCX),
      question mode (AI-generated or manual fixed set)
      (`backend/src/routes/templateRoutes.js`, `frontend/pages/admin/templates/new.js`)
- [x] Single-candidate invite endpoint (bulk invite is Phase 4.7, not built
      here) — creates the `candidate_session` + invite link, deducts 1
      credit (moved from template/interview creation)
      (`POST /api/templates/:templateId/sessions`)
- [x] Candidate flow, addressed by `invite_token` (never the internal
      session id): consent (existing, unchanged) → mandatory resume upload
      (PDF/DOCX, `pdf-parse`/`mammoth`) → one Claude call producing
      personalized questions (AI mode) + a resume-vs-JD score/rationale
      (always) → existing answer/transcript flow, unchanged
      (`backend/src/routes/sessionRoutes.js`, `frontend/pages/invite/[token].js`)
- [x] Resume file storage: Supabase Storage, local-disk fallback in dev
      (`backend/src/services/storageService.js`) — this wasn't actually
      pre-decided despite the task prompt's claim; flagged and decided with
      the user before writing code, see `docs/DECISIONS.md`
- [x] `GET /api/interviews` (now lists templates + embedded candidate
      sessions) and `GET /api/interviews/:id` (now `:id` = candidate_session,
      returns template + session + resume score + transcript + evaluation)
      updated in place — breaking response-shape change, `docs/API.md` updated
- [x] Reviewer dashboard: templates list, expandable to candidate sessions,
      with an inline invite-candidate form (ADMIN only); session detail page
      shows resume score/rationale alongside interview evaluation on the
      same page (no second dashboard view)
      (`frontend/pages/dashboard/index.js`, `frontend/pages/dashboard/[id].js`)
- [x] Backend tests: `backend/tests/templates.test.js`,
      `backend/tests/sessions.test.js` (replaces `voice.test.js`), rewrote
      `backend/tests/interviews.test.js` for the template/session shape —
      59/59 passing
- [x] Bulk invite (many candidates at once against one template) — done in Phase 4.7 below

## Phase 4.7 — Bulk invite
- [x] `POST /api/templates/:templateId/sessions/bulk` — up to 100 candidates
      per batch, all-or-nothing (one DB transaction, 1 credit per session,
      shared `createInvitedSession` helper with the single-invite endpoint)
      (`backend/src/routes/templateRoutes.js`)
- [x] Dashboard: Single/Bulk toggle on the invite panel; bulk accepts pasted
      `name, email` lines or a `.csv` file, shows per-row errors and all
      invite links (`frontend/pages/dashboard/index.js`)
- [x] Tests: 6 new cases in `backend/tests/templates.test.js` — 65/65 passing
- [ ] Automatic invite emails to candidates — not built; admins still copy
      links out (see `docs/DECISIONS.md`)

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
- Self-serve payment/checkout flow for credits (billing UI, card processing,
  invoicing) — Phase 4.5 built the internal credit ledger + ops-only manual
  grant endpoint only; org admins still cannot grant themselves credits
- Full proctoring (beyond tab-switch/fullscreen)
- ATS integrations (so `interview_templates.job_id` stays a free-text label,
  not a real foreign key, until/unless one exists)
- EU AI Act-style mandatory bias audit tooling
- OTP request/verify rate-limiting or lockout (flagged during Phase 4.5 —
  revisit in Phase 7 compliance hardening)
- Org/org_user provisioning UI (still ops-only via `/api/admin/*`) —
  narrower than before: template creation and candidate invites now do have
  an admin UI as of Phase 4.6
- Automatic invite emails to candidates (Resend is already wired for OTP
  codes; would reuse `emailService`)

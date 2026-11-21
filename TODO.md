# TODO / Phase Checklist

Current phase: **Phase 8 — human-feeling voice interview** (planned 2026-11-21; Phases 8–12 then Phase 13 pilot deployment)

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
- [x] Claude-based transcript evaluation against JD (existed since Phase 2;
      now also passes answer mode so voice-transcription errors are discounted)
- [x] Structured feedback report generation — `evaluation.v2`: advisory
      recommendation, strengths/concerns with evidence, 4-6 JD-derived
      criteria scored 1-5 with evidence + question refs, overall 0-100
      (`backend/src/services/anthropicService.js`); migration
      `20261111000000_evaluation_report_v2` adds `recommendation`,
      `strengths`, `concerns`, `prompt_version` to `evaluations`
- [x] Fairness + prompt-injection instructions in the evaluation prompt
- [x] Every LLM call audit-logged with prompt version, input ref, output ref;
      evaluation logged with the triggering reviewer as actor
- [x] Default model `claude-opus-5` → `claude-opus-5-5`, server-side refusal
      fallback enabled
- [x] Decision logic documented in `docs/ARCHITECTURE.md` ("AI decision logic")
- [x] Tests: new `backend/tests/anthropicService.test.js` (SDK mocked) —
      72/72 passing
- [ ] Apply the migration to the real DB (`npx prisma migrate deploy`) and
      run one live evaluation to sanity-check report quality — needs the
      real `DATABASE_URL` / `ANTHROPIC_API_KEY`

## Phase 6 — Reporting & human review
- [x] `human_review_requests` table + migration
      (`backend/prisma/migrations/20261111010000_human_review_requests/`)
- [x] Candidate: `POST /api/sessions/:token/review-requests` (completed
      sessions only, one open at a time) + candidate-safe review status on
      `GET /api/sessions/:token`; request form + reply display on the
      invite completion screen (`frontend/pages/invite/[token].js`)
- [x] Reviewer: review requests on `GET /api/interviews/:id`, open count +
      recommendation on the list, `POST /api/interviews/:id/review-requests/:requestId/resolve`
      (upheld/revised, internal notes, reply to candidate)
- [x] Feedback report UI (recruiter-facing): `frontend/components/FeedbackReport.js`
      renders evaluation.v2 (recommendation, strengths/concerns, criteria
      with evidence + Q refs); numbered transcript; recommendation and
      "Review requested" badges on the dashboard list
- [x] Review panel: `frontend/components/ReviewRequestsPanel.js` on the
      session detail page
- [x] Both sides audit-logged (`human_review_requested`, `human_review_resolved`)
- [x] Tests: request + resolve endpoints — 82/82 passing
- [ ] Apply migration to the real DB (`npx prisma migrate deploy`) — needs
      the real `DATABASE_URL` (same as the Phase 5 migration)
- [ ] Define the human-review process with the pilot client: response-time
      target, queue owner, escalation route (`docs/COMPLIANCE.md`)

## Phase 7 — Compliance hardening
- [x] Full DPDP checklist in `docs/COMPLIANCE.md` reviewed: every item
      re-checked against code; remaining open items need a person or a
      business decision (breach owner, breach alerting, human-review SLA)
- [x] Basic tab-switch/fullscreen detection: `proctoring_events` table,
      `POST /api/sessions/:token/proctoring-events`,
      `frontend/lib/useProctoring.js` (on-screen warning, optional
      fullscreen), "Interview conduct" on the reviewer page; never an AI input
- [x] Data retention/deletion process: `retentionService` anonymizes
      (180-day default, `DATA_RETENTION_DAYS`); `npm run retention` +
      `POST /api/admin/retention/run`; sessions with open review requests held
- [x] Candidate consent withdrawal + erasure: `POST /api/sessions/:token/erasure`,
      link on every candidate page after consent; consent text v2
- [x] Audit log append-only (DB triggers) + per-candidate lookup
      (`GET /api/admin/audit-log`, ops-only, itself logged)
- [x] OTP rate limit (5 per 15 min) and lockout after 5 wrong guesses
      (closes the item parked in Phase 4.5)
- [x] Consent-record ownership check on session start
- [x] Architecture diagram redrawn; README run instructions
- [x] Tests: `backend/tests/retention.test.js` + additions — 108/108 passing
- [ ] Apply migrations `20261111000000`, `20261111010000`, `20261111020000`
      to the real DB (`npx prisma migrate deploy`)
- [ ] Name the breach-response owner + backup (`docs/COMPLIANCE.md`)
- [ ] Counsel review of `docs/COMPLIANCE.md` (esp. breach timelines)

## Phase 7.5 — Frontend UI pass (design system, accessibility, UX)
> Requested 2026-11-21 ("build UI ... follow all applicable best practices").
> All screens already existed from Phases 3–7; this pass reworks how they
> look and behave without changing any API call, request body, or feature
> scope. See `docs/DECISIONS.md` (2026-11-21).
- [x] Design system: Tailwind `brand` token, `@layer components` classes
      (`.btn-*`, `.input`, `.file-input`, `.card`, `.label`, `.hint`) and
      shared primitives in `frontend/components/ui.js` (Button, Field,
      ChoiceCards, SegmentedControl, Alert, Card, PageHeader, Badge,
      StatusBadge, CopyButton/CopyableLink, LoadingState, EmptyState)
- [x] Separate candidate and reviewer shells in `Layout.js` (candidates no
      longer see a "Reviewer dashboard" link); per-page `<title>`, skip
      link, `lang="en"`
- [x] Accessibility: every input has a programmatic label; hints/errors
      wired via `aria-describedby`/`aria-invalid`; radio-based choice cards
      instead of div buttons; `aria-expanded` accordions; progressbar;
      live regions for async status; focus moved to new question / step /
      confirm panels; focusable scrollable consent text; AA text contrast;
      reduced-motion support; `plugin:jsx-a11y/recommended` lint, clean
- [x] Candidate flow: step indicator, no full-page reload flash between
      questions (focus and proctoring listeners survive), unsaved-answer
      warning on leave, Ctrl+Enter submit, recording timer, client-side
      PDF/DOCX + 15 MB check, character counter on review requests
- [x] Reviewer UX: open-review-request alert on the dashboard and detail
      page (with jump link), readable status labels, en-IN dates,
      copy-to-clipboard invite links (+ "copy all" for bulk), credit
      balance refreshes after invites, credit/batch-size warnings, back
      links, two-column session detail on desktop, mobile-safe rows
- [x] `RequireAuth` only redirects to login on a 401; other failures show
      a retry instead of looking like a logout
- [x] Security/privacy headers in `next.config.js` (`Referrer-Policy:
      no-referrer`, no framing, `nosniff`, mic-only Permissions-Policy) and
      site-wide `noindex`; `X-Powered-By` removed
- [x] Custom 404 page
- [x] Verified: `npm run lint` clean, `npm run build` passes, headers
      confirmed on `next start`, screenshots at 390px and 1280px against a
      fixture API (no horizontal overflow)
- [ ] No automated frontend tests yet (no test runner in `frontend/`) —
      parked below
- [x] `AI_MOCK_MODE` for local testing without API keys
      (`backend/src/services/mockAiService.js`, refused in production;
      `backend/tests/mockAi.test.js`) — 115/115 backend tests passing

## Phase 7.6 — Conversational (adaptive) interview
> Requested 2026-11-21: "interview should be conversational instead of
> question and answer. The AI should analyse the answers during the
> conversation and build the questions based on that and based on resume
> and JD". Applies to AI-mode templates; MANUAL templates keep their fixed
> question set. See `docs/DECISIONS.md` (2026-11-21, Phase 7.6).
- [x] Resume upload (AI mode) now makes one call that returns the resume
      score, an interview plan (4-6 topics from JD + resume) and a natural
      opening question (`interview_plan.v1`); only the opening question is
      created up front
- [x] After each answer, one Claude call (`interview_turn.v1`, effort
      `low`, JD/resume/plan prompt-cached) reads the conversation so far and
      chooses a follow-up, a new topic, or the end, with a neutral
      acknowledgement and a reviewer-only "why asked" rationale
- [x] Server-side guard rails (`backend/src/services/conversationService.js`):
      5-10 questions, max 2 follow-ups in a row, no early end; AI failure or
      invalid output falls back to the next planned topic so a candidate is
      never stuck; every override audit-logged (`interview_turn_overridden`)
- [x] Migration `20261121000000_conversational_interview`:
      `candidate_sessions.interview_plan`, `questions.lead_in/kind/topic/rationale`;
      anonymization clears all of them
- [x] `POST /api/sessions/:token/next-question` recovery endpoint (server
      restarted between saving an answer and writing the next question)
- [x] Candidate UI: chat-style conversation, answer shown immediately with a
      "reading your answer" indicator, expected question range instead of a
      fixed total; TTS reads the lead-in + question
- [x] Reviewer UI: question kind badges (opening / follow-up / new topic /
      fallback), topic, "why asked" rationale, interview plan card
- [x] Consent text v3: says answers are sent to the AI during the interview
      to choose follow-ups (new processing purpose under DPDP)
- [x] Evaluation prompt `evaluation.v3`: follow-ups are not negative evidence
- [x] AI_MOCK_MODE: mock plan + turns (short answer -> quoted follow-up)
- [x] Tests: 128/128 (`tests/conversation.test.js`, conversational cases in
      `tests/sessions.test.js`); jest now pins `AI_MOCK_MODE=false`
      (`tests/setupEnv.js`) so a local `.env` can't change test results.
      End-to-end run against the local API in mock mode: plan -> follow-up
      -> new topics -> end, audit entries present, no rationale in the
      candidate view
- [ ] Not verified against the real Claude API (no key in this
      environment) — prompt quality and per-turn latency need a check with a
      real key before the pilot (Phase 8)

## Phase 8 — Human-feeling voice interview (est. 3–4 days)
> Requested 2026-11-21. Greeting → intro → adaptive questions → spoken
> closing; voice interviews are hands-free. Decisions in `docs/DECISIONS.md`.
- [ ] Migration: `candidate_sessions.closing_message` (cleared on anonymization)
- [ ] Config: `INTERVIEWER_NAME` (default "Aria"), `TTS_INSTRUCTIONS`
- [ ] Greeting row (`kind=greeting`): server template, never scored, not
      counted in the 5–10 limit, not passed to the turn AI
- [ ] Intro row: AI acknowledgement of the greeting reply
      (`greeting_ack.v1`) + interviewer self-intro from `interview_plan.v2`
      (named AI interviewer, org, role, format, "a person decides") +
      "tell me about yourself"
- [ ] MANUAL templates: greeting + templated intro lead-in on the first
      fixed question (no extra question, no AI call)
- [ ] `interview_turn.v2`: spoken style; after a no-response always move to
      a new topic (server-enforced + audited)
- [ ] `noResponse: true` answers (VOICE only) stored as a visible marker
- [ ] Closing message stored + `GET /api/sessions/:token/closing/audio`
- [ ] Greetings excluded from the evaluation transcript
- [ ] TTS tone `instructions` for `gpt-4o-mini-tts` (documented in `.env.example`)
- [ ] `VoiceConversation` component: Start → speaking (auto-play, captions,
      replay) → listening (auto mic, level meter, "Done answering",
      "Type instead") → 30 s silence auto-send with a warning at 10 s and
      "I need more time" (WCAG 2.2.1) → next question auto-plays → spoken
      closing
- [ ] Mock mode speaks with the browser's built-in speech synthesis
- [ ] Consent v4 (auto-mic, 30 s auto-send, no review step, follow-ups may
      repeat parts of answers aloud)
- [ ] Reviewer: "Greeting (not scored)" badge, closing message
- [ ] Tests, lint/build, mock e2e, manual voice check, docs, commit

## Phase 9 — Assessments foundation: builder, MCQ/MSQ, sharing, timer, credits (est. 5–7 days)
> New module, separate from interviews (optional `template_id` link only).
- [ ] Migration `assessment_module`: `assessments`, `assessment_questions`,
      `assessment_invites`, `assessment_attempts`, `assessment_answers`,
      `assessment_reports`, `assessment_entry_otps`
- [ ] Admin API + UI: create/edit assessments, MCQ/MSQ editors (skill,
      difficulty, points), publish/close
- [ ] Sharing — email link: invite list (paste/CSV), invite emails,
      read-only access code from the URL + email on the list + email OTP
- [ ] Sharing — open link: name + email entry, one attempt per email
- [ ] Candidate flow: entry → consent → test (navigator, countdown,
      autosave) → submit → done
- [ ] Server-enforced deadline (saves rejected after it, auto-submit)
- [ ] 1 credit per attempt started; 0 credits blocks new attempts
- [ ] Scoring: MCQ full/none, MSQ all-or-nothing, per-skill % → level
      (Beginner <40, Intermediate 40–69, Advanced 70–89, Expert ≥90)
- [ ] Answer keys never sent to candidates
- [ ] Compliance: assessment consent, audit events, retention + erasure
      for attempts, human review (`human_review_requests.attempt_id`)
- [ ] Tests, mock e2e (both sharing modes), docs, commit

## Phase 10 — Assessment proctoring (est. 4–5 days)
- [ ] Copy / cut / paste / drag-drop / right-click blocked page-wide; logged
- [ ] Tab switch, window blur, fullscreen exit: warning with count;
      auto-submit at `max_violations` (default 3)
- [ ] Webcam snapshot every 30 s, stored via `storageService`
- [ ] In-browser face detection (MediaPipe, self-hosted model): no-face /
      multiple-faces flags; server flags snapshot gaps > 90 s
- [ ] System check before start: camera, exactly one face, fullscreen
- [ ] Reviewer: proctoring timeline + snapshot gallery with flags
- [ ] Compliance: `webcam_proctoring` consent; snapshots deleted by
      retention/erasure; face counting only (no recognition); flags are
      reviewer context only, never an auto-fail or AI input
- [ ] Tests, manual webcam check, docs, commit

## Phase 11 — Coding questions: self-hosted Judge0 + in-browser IDE (est. 4–6 days)
- [ ] `infra/judge0` docker-compose (network disabled, CPU/memory limits,
      auth token); local run on Docker Desktop (WSL2 cgroup note)
- [ ] `codeRunnerService` (Python, JavaScript, Java, C, C++); code never
      runs in the backend process; `not_executed` when no runner configured
- [ ] Coding question editor: test cases (sample/hidden, weights), starter
      code per language, limits
- [ ] CodeMirror 6 IDE: language picker, Run on sample tests (≤ 30 runs per
      question), per-test results, paste blocked
- [ ] Final judging on submit against all tests; weighted coding score
- [ ] Reviewer view of code + test results
- [ ] Tests (mocked runner), 4-language check against local Judge0, docs, commit

## Phase 12 — AI question drafts + AI assessment report (est. 4–5 days)
- [ ] `assessment_question_draft.v1`: MCQ/MSQ/coding drafts (with tests +
      reference solution); publish blocked until every draft is approved
- [ ] Validate coding drafts by running the reference solution in Judge0
- [ ] `assessment_report.v1`: per-skill strengths and areas to improve with
      evidence + summary; scores stay deterministic; no proctoring input
- [ ] Report page: score, skill levels, strengths/improvements, answers,
      code, proctoring panel, human review
- [ ] Audit: `assessment_question_drafted`, `assessment_report_generated`
- [ ] Tests (mocked Claude), mock e2e, screenshots, docs, commit

## Phase 13 — Pilot deployment (was Phase 8)
- [ ] Deploy to Railway/Render
- [ ] Judge0 on a separate Linux VM (Indian region, auth token, not publicly
      reachable); set `JUDGE0_URL`
- [ ] Real-API check of interview prompts, TTS voice quality and per-turn
      latency (only mock mode tested so far)
- [ ] Schedule `npm run retention` daily (host cron) — also covers
      assessment attempts and webcam snapshots
- [ ] Turn on hosting/DB login and access alerts (breach detection minimum)
- [ ] Pilot run (50–100 interviews over ~3 months, plus assessments)
- [ ] Post-pilot review

## Parked for later
- AI avatar / video generation
- Self-serve payment/checkout flow for credits (billing UI, card processing,
  invoicing) — Phase 4.5 built the internal credit ledger + ops-only manual
  grant endpoint only; org admins still cannot grant themselves credits
- Full proctoring for interviews (beyond tab-switch/fullscreen) — webcam
  proctoring is in scope for the Assessments module only (Phase 10)
- ATS integrations (so `interview_templates.job_id` stays a free-text label,
  not a real foreign key, until/unless one exists)
- EU AI Act-style mandatory bias audit tooling
- IP-based rate limiting on auth/candidate endpoints (Phase 7 added
  per-user OTP limits only)
- `request-otp` returns 404 for unknown emails (account enumeration);
  change to a uniform response
- Off-site / write-once export of `audit_log` (beyond the DB triggers)
- Org/org_user provisioning UI (still ops-only via `/api/admin/*`) —
  narrower than before: template creation and candidate invites now do have
  an admin UI as of Phase 4.6
- Automatic invite emails to candidates (Resend is already wired for OTP
  codes; would reuse `emailService`)
- Email notifications for human-review requests (to reviewers) and
  resolutions (to candidates) — same channel decision as invite emails
- Printable / exportable feedback report (PDF) — not requested yet
- Frontend automated tests (component tests + an axe accessibility check
  in CI) — Phase 7.5 verified by lint, build and manual screenshots only
- Full Content-Security-Policy (script/style sources) for the frontend —
  only `frame-ancestors` is set; a strict CSP needs nonce support for
  Next.js inline scripts and should be tested on the real host (Phase 8)
- Dark mode for the UI — not requested
- Streaming the next interview question token-by-token (would cut perceived
  wait between answers; measure real per-turn latency first)
- Conversational mode for MANUAL templates (e.g. AI follow-ups on fixed
  questions) — MANUAL promises every candidate the same questions, so not
  done without a product decision
- Using an assessment inside the interview flow (only an optional
  `assessments.template_id` link exists)
- Streaming TTS for the voice interview
- Tuning the voice silence threshold / 30 s limit from pilot feedback
- "Tell me about yourself" question for MANUAL templates
- Per-template limits for the conversational interview (min/max questions
  are global constants in `conversationService.LIMITS`)
- Per-client branding (logo/colour) — the `brand` Tailwind token is the
  hook, but there's no per-org theming

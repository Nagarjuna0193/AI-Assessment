# Architecture

Pilot-scale system (50–100 interviews over ~3 months). Deliberately simple:
no microservices, no premature scaling.

## System diagram

```
                                  +-------------------+
                                  |   Candidate /      |
                                  |   Recruiter (UI)   |
                                  |  React (Next.js)   |
                                  +---------+----------+
                                            |
                                            | HTTPS
                                            v
                          +-----------------------------------+
                          |           Backend API              |
                          |   Node.js + Express /               |
                          |   Next.js API routes                |
                          |                                      |
                          |  +--------------------------------+ |
                          |  |  Consent capture (pre-interview)| |
                          |  |  -> recorded before any LLM call| |
                          |  +--------------------------------+ |
                          |                                      |
                          |  +--------------------------------+ |
                          |  |  Audit logging                  | |
                          |  |  -> every AI decision + prompt/ | |
                          |  |     response logged w/ actor,   | |
                          |  |     timestamp, purpose          | |
                          |  +--------------------------------+ |
                          +----------+-----------------+--------+
                                     |                  |
                          question gen /                | read/write
                          evaluation calls               |
                                     v                  v
                        +------------------+   +------------------+
                        |  LLM (Anthropic  |   |    Postgres      |
                        |  API - Claude)   |   |  (Supabase /     |
                        |                  |   |   Railway)       |
                        |  - question gen  |   |  - candidates    |
                        |    from JD+resume|   |  - interviews    |
                        |  - transcript    |   |  - transcripts   |
                        |    evaluation    |   |  - consent log   |
                        +------------------+   |  - audit log     |
                                                |  - feedback      |
                                                |    reports       |
                                                +------------------+
```

Voice path (Phase 4, re-addressed by invite token in Phase 4.6): candidate
audio -> OpenAI Whisper (STT) -> text, reviewed/edited by the candidate
client-side -> submitted through the same `POST /api/sessions/:token/answers`
used by the text flow (no separate voice answer-storage path). Questions ->
OpenAI TTS -> audio back to the candidate, played on demand (no autoplay).
Audio itself is never persisted — only the transcript. See `docs/DECISIONS.md`
for the provider choice, cost, and consent design.

## Where consent capture and audit logging sit

- **Consent capture** lives in the backend API, gating entry to the interview
  flow. No JD/resume is sent to the LLM and no interview session starts until
  explicit candidate consent is recorded in Postgres with a timestamp.
- **Audit logging** wraps every LLM call (question generation and
  evaluation) in the backend. Each entry records: actor (candidate/system),
  input reference, model + prompt version, output, timestamp, and purpose.
  This supports DPDP breach reporting and gives a human-review path a place
  to start from. See `docs/COMPLIANCE.md`.

## Data model

Schema defined in `backend/prisma/schema.prisma` (Prisma; see
`docs/DECISIONS.md` for tooling choice), migrated via
`backend/prisma/migrations/`.

| Table | Purpose |
|-------|---------|
| `candidates` | Candidate identity (by email) and DPDP retention marker. No longer the parent of interview data as of Phase 4.6 — see below. |
| `consent_records` | DPDP consent trail: consent type, `consent_text_version`, `consent_given_at`, optional `consent_withdrawn_at`, linked to a candidate. |
| `audit_log` | Append-style log of AI-driven actions (question generation, resume scoring, evaluation) and other sensitive actions: actor, action, entity, model/prompt version, input/output references, purpose, timestamp. |
| `organizations` (Phase 4.5) | A client organization (recruiter/hiring team using the tool). Carries `credit_balance` (denormalized for fast reads; `credit_transactions` is the source of truth). |
| `org_users` (Phase 4.5) | Login identity for a person at an organization: `email` (unique), `role` (`ADMIN`/`REVIEWER`), `org_id`. Provisioned by ops — no self-registration. |
| `login_otps` (Phase 4.5) | One-time login codes for org_user email/OTP auth: hashed code, expiry, `consumed_at`. Login infrastructure, kept separate from `audit_log`. |
| `credit_transactions` (Phase 4.5, re-keyed in 4.6) | The credits audit trail — one row per grant or per-**session** deduction: `org_id`, `amount`, `type` (`GRANT`/`DEDUCTION`), `session_id` (deductions only), `added_by`, timestamp. `organizations.credit_balance` is always derivable by summing this table. |
| `interview_templates` (Phase 4.6) | The JD/role a recruiter is hiring for: `role_name`, `job_id` (free-text label, not an ATS FK), `job_description_text`, `question_mode` (`AI`/`MANUAL`), `manual_questions` (JSON, MANUAL mode only), `created_by_org_user_id`. One template, many candidates. |
| `candidate_sessions` (Phase 4.6) | One invited candidate's attempt against a template — **replaces `interviews`** as the parent of `questions`/`responses`/`evaluations`. Carries `invite_token` (the candidate's only way to address their own session), `status`, `mode` (text/voice), `resume_file_ref`/`resume_text`, `resume_jd_score`/`resume_jd_rationale`, `consent_record_id`, timing, and `data_retention_until`. |
| `questions` / `responses` / `evaluations` | Unchanged in purpose from Phase 1/2, just re-keyed to `session_id` (was `interview_id`) — one per `candidate_session` now instead of one per `interviews` row. |
| `human_review_requests` (Phase 6) | DPDP human-review path: a candidate's request (`reason`, optional `evaluation_id` of the latest evaluation at the time) and its resolution (`status` OPEN/RESOLVED, `outcome` upheld/revised, internal `resolution_notes`, `candidate_response`, `resolved_by_org_user_id`, timestamps). Supersedes the unused `evaluations.human_review_requested`/`human_review_notes` columns, which are kept to avoid a destructive migration. |

See `docs/DECISIONS.md` for the full Phase 4.6 migration rationale (why
`interviews` was dropped rather than kept alongside sessions, why
`consent_record_id` is left null on migrated rows, the object-storage and
role-gating choices, etc.).

## Templates & candidate sessions (Phase 4.6)

```
Organization ──< InterviewTemplate ──< CandidateSession ──< Question ──< Response
                 (role, JD, question_mode)   (1 per invited candidate)     │
                                                    │                       │
                                                    ├──< Evaluation ────────┘
                                                    ├── resume_file_ref (Supabase Storage)
                                                    ├── resume_jd_score / rationale
                                                    └── consent_record_id ──> ConsentRecord
```

- **One template, many candidates.** An org admin creates an
  `interview_templates` row once (role, JD text or file, `question_mode`)
  via the Create Interview admin page (`POST /api/templates`, ADMIN-role
  only — new in Phase 4.6, a real gap before now). In `MANUAL` mode the
  fixed question set is written once, here, and shared by every candidate
  invited to it.
- **Inviting a candidate creates the session** (`POST /api/templates/:id/sessions`,
  ADMIN-only) — this is also where the 1-credit deduction now happens
  (moved from interview/template creation in Phase 4.5, so a template with
  zero candidates costs nothing). Bulk invite is Phase 4.7, not built here;
  this is a minimal single-candidate invite, same precedent as the Phase 4.5
  ops-provisioning endpoints.
- **The candidate flow is addressed entirely by `invite_token`** (opaque,
  unguessable), never the internal session id: consent (existing, unchanged)
  -> `POST /api/sessions/:token/start` links the resulting consent record to
  the session -> mandatory resume upload (`POST /api/sessions/:token/resume`,
  PDF/DOCX via `pdf-parse`/`mammoth`) -> **one** Claude call
  (`generateSessionQuestionsAndScore`) that returns personalized questions
  (AI mode only) plus a 0-100 resume-vs-JD score + rationale (always,
  including MANUAL mode) -> the resulting questions (generated or copied
  from the template's manual set) are materialized as `questions` rows on
  the session, and the existing answer/transcript/evaluation flow proceeds
  unchanged from there.
- **The reviewer report is one screen.** `resume_jd_score`/`resume_jd_rationale`
  and the interview `evaluation` both surface on the same session detail
  page (`frontend/pages/dashboard/[id].js`) — no second dashboard view.

## Org auth & credits (Phase 4.5, updated in 4.6)

The candidate-facing flow (consent, resume upload, interview, voice) stays
unauthenticated by design — candidates aren't org_users. Two things are
gated behind org_user login instead:

- **Reviewer dashboard API** (`GET /api/interviews` — now lists templates
  with embedded candidate-session counts/statuses; `GET /api/interviews/:id`
  — now `:id` is a **candidate_session id**, returning template info +
  that session's resume score, transcript, and evaluation) — requires a
  valid `org_session` JWT cookie (email/OTP login,
  `POST /api/auth/request-otp` + `POST /api/auth/verify-otp`) and is scoped
  to the logged-in org_user's own `org_id`. The candidate's own
  refresh-recovery uses the separate, unauthenticated
  `GET /api/sessions/:token` instead, so it isn't affected by this gating.
- **Credits** — deducted atomically on **candidate_session creation** (the
  invite step, Phase 4.6 — moved from interview/template creation in
  Phase 4.5) as part of the same DB transaction that creates the session, so
  the balance can never go negative and a failed deduction rolls back the
  session too. Credits only enter the ledger via an ops-only admin endpoint
  (`POST /api/admin/organizations/:orgId/credits/grant`) — there is no
  self-serve payment/checkout flow (parked, see `TODO.md`).

Ops-only routes (`/api/admin/*`: creating organizations, inviting org_users,
granting credits) are gated by a separate shared secret (`x-ops-key`
header), not the org_user session — this is what guarantees credit grants
stay ops-initiated rather than self-serve. Template creation and candidate
invites are gated differently: they use the org_user session plus an
ADMIN-role check (`requireOrgRole('ADMIN')`), since these are legitimately
org-initiated actions, just restricted to a role within the org. See
`docs/DECISIONS.md` for the reasoning behind all of these choices.

## Data flow (happy path, Phase 4.6)

1. An org ADMIN creates an interview template: role, job ID, JD (text or
   uploaded file), and question mode (AI-personalized or a fixed manual set).
2. The org ADMIN invites a candidate to that template — a `candidate_session`
   is created and exactly 1 credit is deducted.
3. The candidate opens their invite link, consents (recorded), and uploads
   their resume.
4. Backend calls Claude once with the JD + this candidate's resume: AI mode
   returns personalized questions; either mode returns a resume-vs-JD score
   + rationale.
5. Candidate responses are captured as a transcript in Postgres, keyed to
   the candidate_session.
6. A reviewer (org_user) triggers evaluation; backend calls Claude to
   evaluate the transcript against the JD and produce the structured
   feedback report (see "AI decision logic" below).
7. The session detail page shows the resume score/rationale and the
   interview evaluation together — one report, not two screens.
8. Every LLM call in steps 4 and 6 is written to the audit log.

## AI decision logic (Phase 5, for audit readiness)

All Claude calls live in `backend/src/services/anthropicService.js` and go
through one helper (`callStructured`): structured output validated against
a Zod schema, `effort: medium`, server-side refusal fallback enabled. Every
call's prompt version (`PROMPT_VERSIONS`) and the model that actually
answered are written to `audit_log` (`prompt_ref`, `model_version`), along
with `input_ref` / `output_ref` pointers to the data used and produced.

| Decision | When | Inputs | Output | Prompt version |
|----------|------|--------|--------|----------------|
| Personalized questions + resume fit (AI mode) | Candidate uploads resume | JD text, resume text | 5-8 questions; resume-JD score 0-100 + rationale | `session_questions_and_score.v1` |
| Resume fit only (MANUAL mode) | Candidate uploads resume | JD text, resume text | resume-JD score 0-100 + rationale | `resume_score_only.v1` |
| Interview evaluation / feedback report | Reviewer clicks "Run evaluation" on a completed session | JD text, Q&A transcript, answer mode (text/voice) | see below | `evaluation.v2` |

**Evaluation report (`evaluation.v2`)**
- 4-6 criteria derived from the JD, each scored 1-5 with anchors
  (1 = no evidence / below bar, 3 = meets bar, 5 = exceptional with specific
  evidence), with an evidence quote and the question numbers it came from.
- `overallScore` 0-100, consistent with the criteria weighted by role relevance.
- `recommendation`: `advance` / `further_review` / `do_not_advance` —
  **advisory only**; the model is told to prefer `further_review` when the
  evidence is thin. A human reviewer makes the hiring decision.
- `strengths` / `concerns`: each a point plus supporting evidence.
- Fairness instructions: ignore name, gender, age, nationality, religion,
  caste, region, accent and other personal characteristics; don't penalize
  grammar or non-native phrasing unless the JD requires written
  communication; read past voice-transcription errors; unanswered questions
  are missing evidence, not negative evidence.
- Prompt-injection guard: the transcript is treated as data; instructions
  inside it are not followed.
- Not used as inputs: the resume or resume-fit score (scored separately,
  shown alongside) and any proctoring signals.

Re-running evaluation adds a new `evaluations` row (history kept); the
reviewer UI shows the latest.

## Feedback report & human review (Phase 6)

- **Recruiter report**: `frontend/pages/dashboard/[id].js` renders the
  latest evaluation through `frontend/components/FeedbackReport.js`:
  overall score, recommendation badge (labelled advisory), model + prompt
  version, strengths/concerns with evidence, and per-criterion 1-5 scores
  with evidence and `Q<n>` references that match the numbered transcript
  below it. Pre-v2 evaluations render with whatever fields they have. The
  dashboard list shows each session's recommendation and a "Review
  requested" badge when a request is open.
- **Human review**: candidate files a request from the completion screen
  of their invite link -> `human_review_requests` row (OPEN) + audit entry ->
  reviewer sees it on the session page (`ReviewRequestsPanel`) and records
  outcome + internal notes + reply -> row RESOLVED + audit entry ->
  candidate sees the reply on their invite page. The candidate never sees
  scores, the recommendation, or internal notes. Resolving doesn't edit the
  AI evaluation; a `revised` outcome is the human override on record.

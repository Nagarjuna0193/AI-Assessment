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

Voice path (Phase 4): candidate audio -> OpenAI Whisper (STT) -> text,
reviewed/edited by the candidate client-side -> submitted through the same
`POST /:id/answers` used by the text flow (no separate voice answer-storage
path). Questions -> OpenAI TTS -> audio back to the candidate, played on
demand (no autoplay). Audio itself is never persisted — only the transcript.
See `docs/DECISIONS.md` for the provider choice, cost, and consent design.

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
`backend/prisma/migrations/`. No API routes read/write this yet — schema
only as of Phase 1.

| Table | Purpose |
|-------|---------|
| `candidates` | Candidate identity and resume data. Carries `data_retention_until` for DPDP-driven deletion/anonymization. |
| `interviews` | One interview session per candidate: JD text, mode (text/voice), status, timing. Also carries its own `data_retention_until`. |
| `questions` | Interview questions generated for a given interview, in order, tagged with the generating model/prompt version for auditability. |
| `responses` | Candidate answers to questions (text and/or audio reference), linked to both the interview and the specific question. |
| `evaluations` | One structured evaluation/feedback report per interview: overall score, per-criterion `scorecard` JSON, summary, model version, and human-review request/notes fields. |
| `consent_records` | DPDP consent trail: consent type, `consent_text_version`, `consent_given_at`, optional `consent_withdrawn_at`, linked to a candidate and optionally a specific interview. |
| `audit_log` | Append-style log of AI-driven actions (question generation, evaluation) and other sensitive actions: actor, action, entity, model/prompt version, input/output references, purpose, timestamp. |
| `organizations` (Phase 4.5) | A client organization (recruiter/hiring team using the tool). Carries `credit_balance` (denormalized for fast reads; `credit_transactions` is the source of truth). |
| `org_users` (Phase 4.5) | Login identity for a person at an organization: `email` (unique), `role` (`ADMIN`/`REVIEWER`), `org_id`. Provisioned by ops — no self-registration. |
| `login_otps` (Phase 4.5) | One-time login codes for org_user email/OTP auth: hashed code, expiry, `consumed_at`. Login infrastructure, kept separate from `audit_log`. |
| `credit_transactions` (Phase 4.5) | The credits audit trail — one row per grant or per-interview deduction: `org_id`, `amount`, `type` (`GRANT`/`DEDUCTION`), `interview_id` (deductions only), `added_by`, timestamp. `organizations.credit_balance` is always derivable by summing this table. |

`interviews.org_id` (Phase 4.5, nullable) links an interview to the organization that consumed a credit for it — `NULL` for interviews created before this phase.

## Org auth & credits (Phase 4.5)

The candidate-facing flow (consent, interview, answers, voice) stays
unauthenticated by design — candidates aren't org_users. Two things are
gated behind org_user login instead:

- **Reviewer dashboard API** (`GET /api/interviews`, `GET /api/interviews/:id`)
  — requires a valid `org_session` JWT cookie (email/OTP login,
  `POST /api/auth/request-otp` + `POST /api/auth/verify-otp`) and is scoped
  to the logged-in org_user's own `org_id`. The candidate interview screen's
  refresh-recovery moved to a new, deliberately minimal unauthenticated
  endpoint (`GET /api/interviews/:id/progress`) so it isn't affected by this
  gating.
- **Credits** — `POST /api/interviews` now requires an `orgId` (sourced from
  an `?org=` link param the recruiter shares with the candidate, not typed
  in) and atomically deducts 1 credit from that organization's balance as
  part of the same DB transaction that creates the interview, so the balance
  can never go negative and a failed deduction rolls back the interview too.
  Credits only enter the ledger via an ops-only admin endpoint
  (`POST /api/admin/organizations/:orgId/credits/grant`) — there is no
  self-serve payment/checkout flow (parked, see `TODO.md`).

Ops-only routes (`/api/admin/*`: creating organizations, inviting org_users,
granting credits) are gated by a separate shared secret (`x-ops-key`
header), not the org_user session — this is what guarantees credit grants
stay ops-initiated rather than self-serve. See `docs/DECISIONS.md` for the
reasoning behind these choices.

## Data flow (happy path)

1. Recruiter uploads JD + candidate resume.
2. Backend calls Claude to generate interview questions from JD + resume.
3. Candidate consents (recorded) -> interview session starts (text or voice).
4. Candidate responses are captured as a transcript in Postgres.
5. Backend calls Claude to evaluate the transcript against the JD.
6. Backend generates a structured feedback report, stored in Postgres.
7. Every LLM call in steps 2 and 5 is written to the audit log.

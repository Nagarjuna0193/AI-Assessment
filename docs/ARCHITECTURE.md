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

Voice path (Phase 2+): candidate audio -> STT provider -> text -> same
backend flow as text interview -> TTS provider -> audio back to candidate.
Provider choice and rationale to be documented in `DECISIONS.md` when made.

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

## Data flow (happy path)

1. Recruiter uploads JD + candidate resume.
2. Backend calls Claude to generate interview questions from JD + resume.
3. Candidate consents (recorded) -> interview session starts (text or voice).
4. Candidate responses are captured as a transcript in Postgres.
5. Backend calls Claude to evaluate the transcript against the JD.
6. Backend generates a structured feedback report, stored in Postgres.
7. Every LLM call in steps 2 and 5 is written to the audit log.

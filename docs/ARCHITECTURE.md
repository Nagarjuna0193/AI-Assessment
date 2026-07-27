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

## Data flow (happy path)

1. Recruiter uploads JD + candidate resume.
2. Backend calls Claude to generate interview questions from JD + resume.
3. Candidate consents (recorded) -> interview session starts (text or voice).
4. Candidate responses are captured as a transcript in Postgres.
5. Backend calls Claude to evaluate the transcript against the JD.
6. Backend generates a structured feedback report, stored in Postgres.
7. Every LLM call in steps 2 and 5 is written to the audit log.

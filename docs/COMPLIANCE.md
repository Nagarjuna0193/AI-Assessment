# DPDP Act 2023 Compliance Checklist

Tracking checklist derived from `CLAUDE.md`. India-only pilot; no EU AI Act
mandatory bias audit required yet, but designed as if an audit could be
requested: decision logic and data flow are documented from day one.

**Phase 7 review (2026-11-11):** every item below was re-checked against
the code. Items still open need a person or a business decision, not more
code; each says what is missing. This is an engineering checklist, not a
legal opinion. Have counsel review it before the pilot starts.

## Consent

- [x] Explicit candidate consent captured before any resume/JD data is sent
      to the LLM. Resume upload (the only path that calls Claude with
      candidate data) requires an `IN_PROGRESS` session, and a session only
      becomes `IN_PROGRESS` through `POST /api/sessions/:token/start`, which
      checks for live `data_processing` consent.
- [x] Consent captured before an interview session (text or voice) starts.
      Same check. Phase 7 also verifies the `consentRecordId` the browser
      sends is this candidate's own live `data_processing` record.
- [x] Voice interviews require a second, explicit `voice_recording` consent
      (on top of `data_processing`) before audio is sent to the STT/TTS
      provider, enforced at session start and re-checked on every
      transcription call (Phase 4).
- [x] Consent record includes timestamp, candidate identity, and scope:
      `consent_records` stores `candidate_id`, `consent_type`,
      `consent_text_version`, `consent_given_at`, `consent_withdrawn_at`.
      The text for each version lives in `frontend/pages/invite/[token].js`
      and its git history (v1 up to Phase 6; v2 from Phase 7 adds
      tab/fullscreen monitoring, the retention period, and in-page
      withdrawal).
- [x] Candidate can withdraw consent and understand what that means
      (Phase 7). Every page after consent has a "Withdraw consent and delete
      my data" link with a confirm step that explains the effect
      (`POST /api/sessions/:token/erasure`); see "Data retention & erasure".

## Data minimization

- [x] Only data needed for question generation and evaluation is
      collected: name, email (to invite), resume, and interview answers.
      Phone is optional and the candidate flow doesn't ask for it. The IP
      address on `consent_records` is kept as proof of consent and cleared
      on anonymization. The evaluation call gets JD + transcript only, not
      the resume (Phase 5).
- [x] No collection beyond the stated purpose. Voice audio is transcribed
      in memory and discarded (Phase 4). Proctoring (Phase 7) records only
      the event type and server time of a tab switch or fullscreen exit:
      no screenshots, keystrokes, camera, or page content. It is shown to
      the reviewer as context and never sent to the AI evaluation.
- [x] Data retention period defined and enforced (Phase 7). See below.
      Enforcement needs the retention job scheduled on the host, which is
      part of Phase 8 deployment.

## Data retention & erasure (Phase 7)

- **Retention period:** `DATA_RETENTION_DAYS`, default **180 days** after
  the interview completes (`candidate_sessions.data_retention_until`, set
  on completion). Sessions never completed fall back to 180 days after the
  invite was created.
- **Job:** `npm run retention` in `backend/` (or `POST
  /api/admin/retention/run` with the ops key). Schedule it daily. Use
  `--dry-run` / `{"dryRun": true}` to list what would change. A session with
  an **open** human-review request is held until the request is resolved.
- **Erasure on request:** the candidate's withdraw-and-delete link runs the
  same anonymization immediately. An in-progress interview is cancelled.
- **What anonymization does** (`backend/src/services/retentionService.js`):
  - deletes the original resume file from storage (if this fails nothing
    else changes, and the next run retries)
  - session: name -> `[removed]`, email -> `anonymized+<id>@invalid.local`,
    resume text and resume-fit rationale cleared
  - questions and answers -> `[removed]` (AI questions are personalized
    from the resume)
  - evaluations: summary, strengths, concerns and per-criterion evidence
    and notes cleared. Overall score, recommendation, and criterion names
    with scores are kept for aggregate pilot reporting.
  - human-review requests: reason, notes and reply cleared; open ones
    closed with outcome `data_erased`
  - when the candidate has no other live session: the `candidates` row is
    anonymized the same way, their consents are marked withdrawn, and
    stored IP addresses are cleared
  - kept unchanged: credit ledger, proctoring counts, consent timestamps,
    audit log (which holds ids and refs, not personal text)
  - writes an `audit_log` entry `data_anonymized` (actor `system` for
    retention, `candidate` for an erasure request)

## Breach reporting

- [ ] Responsible contact/owner identified for breach response.
      **Open: needs a named person and a backup.** Fill in below.
- [x] Process defined for reporting a breach (below). The timelines follow
      the DPDP Rules 2025 as we understand them; **confirm with counsel**.
- [ ] Process defined for detecting a data breach. **Partly done.** What
      exists: `audit_log` (append-only) shows who accessed or changed what
      through the app; Railway/Render and Supabase keep their own access
      logs. What's missing: alerting. At pilot scale the minimum is turning
      on the hosting provider's login and DB alerts and reviewing them
      weekly; decide this at deployment (Phase 8).

### Breach response process (pilot)

**Owner:** _TBD (name, phone, email)_ · **Backup:** _TBD_

1. **Contain.** Rotate the affected credentials (`DATABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `STT_TTS_PROVIDER_API_KEY`, `JWT_SECRET`, `OPS_API_KEY`) and revoke
   sessions by rotating `JWT_SECRET`.
2. **Scope.** Use `audit_log` and provider logs to identify affected
   candidates and organizations. `GET /api/admin/audit-log` gives one
   candidate's trail.
3. **Notify the Data Protection Board of India** without delay on becoming
   aware, then a detailed report (nature, extent, timing, likely impact,
   mitigation) within **72 hours**.
4. **Notify affected candidates** without delay: what happened, likely
   consequences, what we're doing, what they can do, and a contact.
5. **Notify client organizations** whose candidates are affected (they
   may have their own obligations).
6. **Record** the incident, timeline and decisions in a post-incident note
   kept with these docs.

## Audit logging of AI decisions

- [x] Every LLM call (question generation, resume scoring, evaluation) is
      logged with actor, timestamp, input reference, model + prompt version,
      and output reference (Phase 5, `PROMPT_VERSIONS` in
      `backend/src/services/anthropicService.js`).
- [x] STT transcription of a candidate's spoken answer is logged
      (`voice_answer_transcribed`). TTS of question text is not logged; it
      doesn't process candidate data.
- [x] Audit log is tamper-resistant / append-only (Phase 7). Database
      triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log`
      (migration `20261111020000_compliance_hardening`). Anonymization
      never touches it. Limit: a database owner can drop the triggers, so
      this stops accidental or app-level changes, not a compromised DB
      admin. Off-site log export would close that gap if an audit demands
      it (parked).
- [x] Audit log is queryable for a specific candidate (Phase 7):
      `GET /api/admin/audit-log?email=|candidateId=|sessionId=` (ops key).
      It returns every entry for the candidate's sessions, evaluations,
      review requests and consents, and logs the lookup itself
      (`audit_log_queried`). After anonymization, look up by `sessionId` or
      `candidateId`.

## Human-review path

- [x] Candidate can request human review of an AI-generated evaluation
      (Phase 6), from the completion screen of their invite link.
- [x] Human-review request and outcome are recorded (Phase 6) in
      `human_review_requests`, with both sides written to `audit_log`.
- [ ] Process defined for who performs human review and how disputes are
      resolved. **Partly done.** The product enforces: any org_user of the
      candidate's organization can resolve; resolving requires internal
      notes and a reply to the candidate; the candidate can file again
      after a resolution. **Open (client decision):** response-time
      commitment, who owns the queue, escalation route.

## Documentation readiness (in case of future audit request)

- [x] Decision logic for question generation documented
      (`docs/ARCHITECTURE.md`, "AI decision logic")
- [x] Decision logic for evaluation/scoring documented (same section)
- [x] Data flow diagram kept up to date (`docs/ARCHITECTURE.md`, redrawn in
      Phase 7)
- [x] Assumptions log kept up to date (`docs/DECISIONS.md`)

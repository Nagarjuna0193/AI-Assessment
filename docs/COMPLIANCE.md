# DPDP Act 2023 Compliance Checklist

Tracking checklist derived from `CLAUDE.md`. India-only pilot; no EU AI Act
mandatory bias audit required yet, but designed as if an audit could be
requested — decision logic and data flow are documented from day one.

## Consent

- [ ] Explicit candidate consent captured before any resume/JD data is sent
      to the LLM
- [ ] Consent captured before an interview session (text or voice) starts
- [x] Voice interviews require a second, explicit `voice_recording` consent
      (on top of `data_processing`) before audio is sent to the STT/TTS
      provider — enforced server-side in `POST /api/interviews` and
      re-checked on every `POST /:id/answers/transcribe` call, not just at
      interview creation (Phase 4 — see `docs/DECISIONS.md`)
- [ ] Consent record includes timestamp, candidate identity, and scope of
      what was consented to
- [ ] Candidate can withdraw consent and understand what that means for their
      application

## Data minimization

- [ ] Only data needed for question generation and evaluation is collected
      (JD, resume, interview transcript)
- [x] No collection of data beyond stated purpose (e.g. no unnecessary
      biometric or behavioral data beyond basic tab-switch/fullscreen
      detection): voice answers are transcribed in-memory and the raw audio
      is discarded immediately after — only the resulting text transcript is
      persisted (Phase 4; `responses.response_audio_url` stays unused/null)
- [ ] Data retention period defined and enforced (delete/anonymize after
      retention window)

## Breach reporting

- [ ] Process defined for detecting a data breach
- [ ] Process defined for reporting a breach per DPDP Act timelines
- [ ] Responsible contact/owner identified for breach response

## Audit logging of AI decisions

- [x] Every LLM call (question generation, resume scoring, evaluation) is
      logged with actor, timestamp, input reference, model + prompt version,
      and output reference (Phase 5 — `PROMPT_VERSIONS` in
      `backend/src/services/anthropicService.js`)
- [x] STT transcription of a candidate's spoken answer is logged
      (`action: voice_answer_transcribed`) since it processes candidate
      personal data via a third-party provider (Phase 4). TTS of question
      text is not logged — it doesn't process candidate data, only reads
      back already-generated (and already-logged) question text.
- [ ] Audit log is tamper-resistant / append-only
- [ ] Audit log is queryable for a specific candidate on request

## Human-review path

- [x] Candidate can request human review of an AI-generated evaluation
      (Phase 6) — from the completion screen of their invite link
      (`POST /api/sessions/:token/review-requests`). Available once the
      interview is complete, whether or not an evaluation has run yet; one
      open request at a time.
- [x] Human-review request and outcome are recorded (Phase 6) —
      `human_review_requests` table (reason, linked evaluation if any,
      status, outcome `upheld`/`revised`, internal notes, reply to the
      candidate, who resolved it and when). Both the request
      (`human_review_requested`, actor `candidate`) and the resolution
      (`human_review_resolved`, actor `recruiter` + org_user id) are written
      to `audit_log`.
- [ ] Process defined for who performs human review and how disputes are
      resolved — **partly done**. What the product enforces: any org_user
      (ADMIN or REVIEWER) of the candidate's organization can resolve a
      request; resolving requires internal notes and a written reply to the
      candidate; the candidate sees the reply on their invite page and can
      file a new request after a resolution. **Still open (business/client
      decision, not code):** a response-time commitment, who at the client
      org owns the queue, and an escalation route if the candidate still
      disagrees. Reviewers are not notified by email yet — open requests
      show as a "Review requested" badge on the dashboard.

## Documentation readiness (in case of future audit request)

- [x] Decision logic for question generation documented
      (`docs/ARCHITECTURE.md` → "AI decision logic")
- [x] Decision logic for evaluation/scoring documented (same section;
      includes fairness instructions and what is *not* used as input)
- [ ] Data flow diagram kept up to date (`docs/ARCHITECTURE.md`)
- [ ] Assumptions log kept up to date (`docs/DECISIONS.md`)

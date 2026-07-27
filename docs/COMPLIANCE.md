# DPDP Act 2023 Compliance Checklist

Tracking checklist derived from `CLAUDE.md`. India-only pilot; no EU AI Act
mandatory bias audit required yet, but designed as if an audit could be
requested — decision logic and data flow are documented from day one.

## Consent

- [ ] Explicit candidate consent captured before any resume/JD data is sent
      to the LLM
- [ ] Consent captured before an interview session (text or voice) starts
- [ ] Consent record includes timestamp, candidate identity, and scope of
      what was consented to
- [ ] Candidate can withdraw consent and understand what that means for their
      application

## Data minimization

- [ ] Only data needed for question generation and evaluation is collected
      (JD, resume, interview transcript)
- [ ] No collection of data beyond stated purpose (e.g. no unnecessary
      biometric or behavioral data beyond basic tab-switch/fullscreen
      detection)
- [ ] Data retention period defined and enforced (delete/anonymize after
      retention window)

## Breach reporting

- [ ] Process defined for detecting a data breach
- [ ] Process defined for reporting a breach per DPDP Act timelines
- [ ] Responsible contact/owner identified for breach response

## Audit logging of AI decisions

- [ ] Every LLM call (question generation, evaluation) is logged with actor,
      timestamp, input reference, model/prompt version, and output
- [ ] Audit log is tamper-resistant / append-only
- [ ] Audit log is queryable for a specific candidate on request

## Human-review path

- [ ] Candidate can request human review of an AI-generated evaluation
- [ ] Human-review request and outcome are recorded
- [ ] Process defined for who performs human review and how disputes are
      resolved

## Documentation readiness (in case of future audit request)

- [ ] Decision logic for question generation documented
- [ ] Decision logic for evaluation/scoring documented
- [ ] Data flow diagram kept up to date (`docs/ARCHITECTURE.md`)
- [ ] Assumptions log kept up to date (`docs/DECISIONS.md`)

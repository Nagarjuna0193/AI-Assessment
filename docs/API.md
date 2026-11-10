# API Reference

Backend API for the interview flow. Base path: `/api`. All bodies/responses
are JSON, except where noted (file upload/audio). Three groups of endpoints,
by who calls them:

- **Candidate-facing** (`/api/consent`, `/api/sessions/:token/*`) —
  unauthenticated by design, addressed by an opaque `invite_token`. See
  `docs/DECISIONS.md`.
- **Reviewer/admin-facing** (`/api/interviews/*`, `/api/templates/*`) —
  require an org_user session (Phase 4.5); template creation and candidate
  invites additionally require the `ADMIN` role (Phase 4.6).
- **Ops-only** (`/api/admin/*`) — a separate shared secret, never self-serve.

## `GET /health`

Liveness check.

**Response `200`**
```json
{ "status": "ok" }
```

---

## `POST /api/consent`

Records DPDP consent for a candidate. Unchanged since Phase 2 — still the
only path that may record consent, still upserts the `candidates` row by
email. In the Phase 4.6 candidate flow it's called from the invite-link
consent screen using the `candidateName`/`email` already on the
candidate_session (the candidate doesn't retype them), and the resulting
`consentRecord.id` is then passed to `POST /api/sessions/:token/start` (below)
to link it to that session.

**Request body**
```json
{
  "email": "candidate@example.com",
  "fullName": "Jane Doe",
  "phone": "+91...",              // optional
  "consentType": "data_processing",
  "consentTextVersion": "v1",
  "ipAddress": "203.0.113.1"      // optional — falls back to req.ip
}
```

**Response `201`**
```json
{
  "candidate": { "id": "...", "email": "...", "fullName": "...", ... },
  "consentRecord": { "id": "...", "candidateId": "...", "consentType": "data_processing", ... }
}
```

**Errors**
- `400 invalid_request` — missing `email`, `fullName`, `consentType`, or `consentTextVersion`.

Writes an `audit_log` entry (`action: consent_recorded`).

---

## Templates (Phase 4.6, org ADMIN only)

An `interview_templates` row is the JD/role a recruiter is hiring for —
created once, then many candidates are invited against it. Requires an
`org_session` cookie **and** `role: "ADMIN"` — a `REVIEWER`-role org_user
gets `403 forbidden`. This is the "Create Interview" admin page's backing
endpoint; it didn't exist before Phase 4.6 (a real gap, not something
previously deferred).

### `POST /api/templates`

**Request**: `multipart/form-data` (so an optional JD file upload can share
the endpoint with plain text fields) or plain JSON if no file is attached.

| Field | Required | Notes |
|---|---|---|
| `roleName` | yes | |
| `jobId` | no | Free-text internal label (e.g. `"REQ-1234"`) — not a foreign key, no ATS integration. |
| `jobDescriptionText` | one of this or `jobDescriptionFile` | |
| `jobDescriptionFile` | one of this or `jobDescriptionText` | PDF/DOCX — extracted via `pdf-parse`/`mammoth`, same parser the candidate resume upload uses. |
| `questionMode` | no (default `AI`) | `"AI"` or `"MANUAL"`. |
| `manualQuestions` | required if `questionMode: "MANUAL"` | JSON array of question strings (as a string field if sent via `multipart/form-data`). |

**Response `201`**: `{ "template": { "id", "orgId", "roleName", "jobId", "jobDescriptionText", "questionMode", "manualQuestions", ... } }`

**Errors**
- `401 auth_required` / `403 forbidden` (non-ADMIN role)
- `400 invalid_request` — missing `roleName`; neither JD text nor file provided; `questionMode: "MANUAL"` with no (or empty) `manualQuestions`.
- `400 unsupported_file_type` — `jobDescriptionFile` isn't a PDF or DOCX.

Not written to `audit_log` — text extraction from an uploaded file isn't an AI decision.

### `POST /api/templates/:templateId/sessions`

Invite **one** candidate to a template — creates the `candidate_sessions`
row and atomically deducts 1 credit (moved here from template/interview
creation in Phase 4.5 — a template with zero candidates now costs nothing).
For many candidates at once, see the bulk endpoint below.

**Request body**: `{ "candidateName": "Jane Doe", "email": "jane@example.com" }`

**Response `201`**
```json
{
  "session": { "id": "...", "candidateName": "Jane Doe", "email": "...", "status": "INVITED", "inviteToken": "..." },
  "inviteLink": "http://localhost:3000/invite/<token>"
}
```

**Errors**
- `401 auth_required` / `403 forbidden` (non-ADMIN role)
- `400 invalid_request` — missing `candidateName` or `email`.
- `404 template_not_found` — no such template, or it belongs to a different org.
- `402 insufficient_credits` — the organization has no credits remaining.

Writes a `credit_transactions` entry (`type: DEDUCTION`) referencing the new session.

### `POST /api/templates/:templateId/sessions/bulk` (Phase 4.7)

Invite up to 100 candidates against one template in a single call.
**All-or-nothing**: every row is validated first, then all sessions are
created (and 1 credit deducted per session) in one DB transaction — if any
row is invalid or credits run out mid-batch, nobody is invited and no
credits are spent. The dashboard parses pasted lines / a `.csv` file into
this JSON shape client-side.

**Request body**
```json
{ "candidates": [ { "candidateName": "Jane Doe", "email": "jane@example.com" }, ... ] }
```
Emails are trimmed and lower-cased; names are trimmed.

**Response `201`**: `{ "invites": [ { "session": {...}, "inviteLink": "..." }, ... ] }`
(same per-invite shape as the single-invite endpoint, in request order).

**Errors**
- `401 auth_required` / `403 forbidden` (non-ADMIN role)
- `400 invalid_request` — `candidates` missing or empty.
- `400 too_many_candidates` — more than 100 rows.
- `400 invalid_rows` — one or more rows failed validation; body includes
  `rowErrors: [{ "row": 2, "message": "a valid email is required" }, ...]`
  (1-indexed). Covers missing name, invalid email, duplicate email within the batch.
- `404 template_not_found`
- `402 insufficient_credits` — fewer credits than rows (checked up front), or
  credits ran out during the transaction (rolled back).

---

## Candidate sessions (Phase 4.6, unauthenticated, addressed by `invite_token`)

The entire candidate flow — consent-linking, resume upload, answering,
voice — is addressed by the opaque `invite_token` from the invite link,
never the internal session id reviewers use.

### `GET /api/sessions/:token`

Fetches session/template state — drives which screen the candidate flow
shows (consent / resume upload / interview / complete) and recovers
progress on a page refresh.

**Response `200`**
```json
{
  "status": "IN_PROGRESS",
  "mode": "TEXT",
  "candidateName": "Jane Doe",
  "email": "jane@example.com",
  "roleName": "Backend Engineer",
  "resumeUploaded": true,
  "transcript": [
    { "questionId": "...", "orderIndex": 0, "questionText": "...", "responseText": "..." }
  ]
}
```

**Errors**
- `404 session_not_found` — invalid or expired invite link.

### `POST /api/sessions/:token/start`

Called right after the (unchanged) consent screen's `POST /api/consent`
succeeds — links that consent record to this session, records the
candidate's chosen mode, and moves the session to `IN_PROGRESS`.
Re-validates consent server-side the same way the old `POST /api/interviews`
did (same consent-type-per-mode rule, see `docs/DECISIONS.md`).

**Request body**: `{ "consentRecordId": "...", "mode": "TEXT" }` — `mode` optional, `"TEXT"` (default) or `"VOICE"`.

**Response `200`**: `{ "status": "IN_PROGRESS" }`

**Errors**
- `400 invalid_request` — missing `consentRecordId`.
- `404 session_not_found`
- `409 session_not_invited` — session isn't currently `INVITED`.
- `404 candidate_not_found`
- `403 consent_required` — no valid consent record covering the required type(s) for the chosen mode.

### `POST /api/sessions/:token/resume`

Mandatory resume upload. Extracts text (`pdf-parse`/`mammoth`), stores the
original file (Supabase Storage, or local disk in dev — see
`docs/DECISIONS.md`), then makes **one** Claude call
(`generateSessionQuestionsAndScore`) that returns personalized questions
(AI mode only) plus a resume-vs-JD score + rationale (always — MANUAL mode
still gets scored, just skips question generation). The resulting questions
(generated, or copied from the template's fixed `manualQuestions`) are
materialized as this session's `questions` rows.

**Request**: `multipart/form-data` with a single field `resume` (PDF/DOCX).

**Response `200`**
```json
{
  "totalQuestions": 6,
  "firstQuestion": { "id": "...", "orderIndex": 0, "questionText": "..." }
}
```

**Errors**
- `400 invalid_request` — no `resume` file attached.
- `400 unsupported_file_type` — not a PDF or DOCX.
- `404 session_not_found`
- `409 session_not_in_progress` — must have completed `/start` first.
- `409 resume_already_uploaded`
- `502 question_generation_declined` / `502 question_generation_failed` — Claude declined, or its response didn't match the expected schema (covers both the AI-mode question+score call and the MANUAL-mode score-only call).

Writes an `audit_log` entry `question_generated` (AI mode only) and always writes `resume_jd_scored`, both recording the model version used.

### `POST /api/sessions/:token/answers`

Submits a candidate's answer. Identical behavior to the old
`POST /api/interviews/:id/answers` — returns the next question or an
end-of-interview signal, marks the session `COMPLETED` once every question
has a response.

**Request body**: `{ "questionId": "...", "responseText": "..." }`

**Response `200` — more questions remain**: `{ "done": false, "nextQuestion": { "id", "orderIndex", "questionText" } }`

**Response `200` — interview complete**: `{ "done": true, "message": "Interview complete" }`

**Errors**
- `400 invalid_request` — missing `questionId` or `responseText`.
- `404 session_not_found`
- `409 session_not_in_progress`
- `404 question_not_found` — doesn't exist, or doesn't belong to this session.
- `409 already_answered`

### `POST /api/sessions/:token/answers/transcribe`

STT — identical behavior to the old (Phase 4) voice-transcribe endpoint,
just session/token-scoped now. Does not persist a response.

**Request**: `multipart/form-data`, field `audio`.

**Response `200`**: `{ "text": "transcribed answer text" }`

**Errors**
- `400 invalid_request` — no `audio` file attached.
- `404 session_not_found`
- `409 session_not_in_progress`
- `403 voice_not_enabled` — session wasn't started with `mode: "VOICE"`.
- `403 voice_consent_required`
- `502 stt_failed`

Writes an `audit_log` entry (`action: voice_answer_transcribed`).

### `GET /api/sessions/:token/questions/:questionId/audio`

TTS — identical behavior to the old (Phase 4) endpoint, session/token-scoped.

**Response `200`**: `audio/mpeg` binary body.

**Errors**
- `404 session_not_found` / `404 question_not_found`
- `502 tts_failed`

Not written to `audit_log` (same reasoning as before — no candidate personal data involved).

---

## `GET /api/interviews`

Lists **interview templates** belonging to the logged-in org_user's
organization, most recent first, each with its candidate sessions embedded
(counts, per-status breakdown, and a summary array) so the reviewer
dashboard's "expandable to candidate sessions" list needs one request.
**Breaking change from Phase 2**: this used to list flat interviews — see
`docs/DECISIONS.md`. **Requires an org_user session** (any role).

**Errors**
- `401 auth_required`

**Response `200`**
```json
{
  "templates": [
    {
      "id": "...",
      "roleName": "Backend Engineer",
      "jobId": "REQ-1",
      "questionMode": "AI",
      "createdAt": "...",
      "sessionCount": 2,
      "statusCounts": { "COMPLETED": 1, "INVITED": 1 },
      "sessions": [
        {
          "id": "...",
          "candidateName": "Jane Doe",
          "email": "jane@example.com",
          "status": "COMPLETED",
          "resumeJdScore": 82,
          "createdAt": "...",
          "evaluationScore": 78
        }
      ]
    }
  ]
}
```

---

## `GET /api/interviews/:id`

Fetches one **candidate session** (`:id` is a `candidate_sessions` id, not a
template id) plus its template info, resume score, transcript, and
evaluation. **Breaking change from Phase 2**: this used to return one flat
interview — see `docs/DECISIONS.md`. **Requires an org_user session**; a
session belonging to a different organization returns `404`, not `403`, so
its existence isn't leaked across orgs.

**Response `200`**
```json
{
  "template": {
    "id": "...", "roleName": "Backend Engineer", "jobId": "REQ-1",
    "jobDescriptionText": "...", "questionMode": "AI"
  },
  "session": {
    "id": "...", "candidateName": "Jane Doe", "email": "...",
    "status": "COMPLETED", "mode": "TEXT",
    "resumeJdScore": 82, "resumeJdRationale": "...",
    "createdAt": "...", "completedAt": "..."
  },
  "transcript": [
    { "questionId": "...", "orderIndex": 0, "questionText": "...", "responseText": "..." }
  ],
  "evaluation": { "id": "...", "overallScore": 78, "summaryText": "...", "scorecard": [...] } // or null
}
```

**Errors**
- `401 auth_required`
- `404 session_not_found` — no such session, or it belongs to a different organization.

---

## `POST /api/interviews/:id/evaluate`

Triggers evaluation of a completed session's full transcript: calls Claude
with the template's JD + all question/answer pairs, and stores the
structured score + feedback. Unchanged in behavior from Phase 2, just
re-keyed to a candidate_session id. **Requires an org_user session** (any
role — evaluation isn't ADMIN-restricted).

**Request body:** none required.

**Response `201`**
```json
{
  "evaluation": {
    "id": "...",
    "sessionId": "...",
    "overallScore": 78,
    "summaryText": "...",
    "scorecard": [
      { "criterion": "Technical depth", "score": 8, "notes": "..." }
    ],
    "modelVersion": "claude-opus-5",
    ...
  }
}
```

**Errors**
- `401 auth_required`
- `404 session_not_found`
- `409 session_not_complete` — not all questions have been answered yet.
- `502 evaluation_declined` / `502 evaluation_failed`

Writes an `audit_log` entry (`action: evaluation_generated`).

---

## Auth (Phase 4.5)

Org_user login: email/OTP, session held as a JWT in an httpOnly cookie
(`org_session`). Org_users are provisioned by ops (see "Admin" below) — there
is no self-serve sign-up. See `docs/DECISIONS.md` for the JWT-vs-session-store
choice.

### `POST /api/auth/request-otp`

**Request body**: `{ "email": "reviewer@company.com" }`

**Response `200`**: `{ "message": "OTP sent" }`

**Errors**
- `400 invalid_request` — missing `email`.
- `404 org_user_not_found`

In dev/test (no `AUTH_EMAIL_PROVIDER_API_KEY` configured), the OTP is logged
to the console instead of emailed — see `docs/DECISIONS.md`.

### `POST /api/auth/verify-otp`

**Request body**: `{ "email": "...", "code": "123456" }`

**Response `200`**: sets the `org_session` cookie; body is
`{ "orgUser": { "id", "email", "orgId", "role" } }`.

**Errors**
- `400 invalid_request` — missing `email` or `code`.
- `404 org_user_not_found`
- `401 otp_expired_or_invalid` — no matching unconsumed OTP, it's expired, or the code is wrong.

### `POST /api/auth/logout`

Clears the session cookie. **Response `200`**: `{ "message": "Logged out" }`

### `GET /api/auth/me`

Current session's org_user + organization (for the dashboard header/credit
display). **Requires an org_user session.**

**Response `200`**
```json
{
  "orgUser": { "id": "...", "email": "...", "role": "REVIEWER" },
  "organization": { "id": "...", "name": "...", "creditBalance": 12 }
}
```

**Errors**
- `401 auth_required`

---

## Admin / ops (Phase 4.5)

All routes under `/api/admin` require an `x-ops-key` header matching the
`OPS_API_KEY` env var — a separate secret from org_user auth, so these
actions can only be triggered by the team operating the pilot, never
self-serve by an org (see `docs/DECISIONS.md`). Not exposed in any frontend
UI; called directly (e.g. via `curl`/Postman) by ops. (Contrast with
"Templates" above, which *is* org-initiated — just role-gated to `ADMIN`.)

### `POST /api/admin/organizations`

Provision a new client organization (starts with 0 credits).

**Request body**: `{ "name": "Acme Corp" }`

**Response `201`**: `{ "organization": { "id", "name", "creditBalance": 0, ... } }`

### `POST /api/admin/organizations/:orgId/users`

Invite an org_user (no self-registration).

**Request body**: `{ "email": "reviewer@acme.com", "role": "REVIEWER" }` — `role` optional, `"ADMIN"` or `"REVIEWER"` (default).

**Response `201`**: `{ "orgUser": { "id", "email", "orgId", "role", ... } }`

**Errors**
- `400 invalid_request` — missing `email`, or invalid `role`.
- `404 organization_not_found`

### `POST /api/admin/organizations/:orgId/credits/grant`

Manually grant credits to an organization — the only way credits enter the
ledger in this phase (no payment gateway/checkout; parked for later, see
`TODO.md`). Records a `credit_transactions` row (`type: GRANT`).

**Request body**: `{ "amount": 50, "addedBy": "ops@ourcompany.com" }`

**Response `201`**: `{ "organization": { "id", "name", "creditBalance", ... } }`

**Errors**
- `400 invalid_request` — `amount` not a positive integer, or missing `addedBy`.
- `404 organization_not_found`

---

## Notes

- Every Claude call (question/score generation, evaluation) uses structured
  output (`output_config.format` with a Zod schema via `messages.parse()`)
  rather than free-text parsing, so a malformed response is caught and
  surfaced as `502`, not silently stored.
- Default model: `claude-opus-5` (overridable via `ANTHROPIC_MODEL`) — see
  `docs/DECISIONS.md` for the cost/quality tradeoff note.
- Resume/JD file text extraction (`pdf-parse` for PDF, `mammoth` for DOCX)
  is shared between the candidate resume upload and the admin JD file
  upload — see `backend/src/services/resumeParserService.js`.

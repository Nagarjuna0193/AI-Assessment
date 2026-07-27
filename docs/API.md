# API Reference

Backend API for the interview flow. Base path: `/api`. All bodies/responses
are JSON. No auth middleware yet (still open from Phase 1/2 — see `TODO.md`).

## `GET /health`

Liveness check.

**Response `200`**
```json
{ "status": "ok" }
```

---

## `POST /api/consent`

Records DPDP consent for a candidate. Must be called — and succeed — before
`POST /api/interviews` will allow an interview to start for that candidate.
Creates the candidate record if one doesn't exist yet (upsert by email).
`consentType` is a free string; the app currently checks for
`"data_processing"` (always required) and `"voice_recording"` (required in
addition, only when starting a `mode: "VOICE"` interview — see
`backend/src/config.js`).

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

## `POST /api/interviews`

Creates an interview for a candidate: accepts JD text + resume text, calls
Claude to generate a structured question set, and persists the interview +
questions. **Consent is enforced here at the API level** — a candidate
without a recorded, non-withdrawn consent record covering the required
consent type(s) (see `backend/src/config.js`) cannot start an interview,
regardless of what the frontend does. `mode: "VOICE"` requires an additional
`voice_recording` consent record on top of `data_processing` — see
`docs/DECISIONS.md`.

**Request body**
```json
{
  "candidateEmail": "candidate@example.com",
  "jobTitle": "Backend Engineer",     // optional
  "jobDescriptionText": "...",
  "resumeText": "...",
  "mode": "TEXT"                       // optional — "TEXT" (default) or "VOICE"
}
```

**Response `201`**
```json
{
  "interviewId": "...",
  "totalQuestions": 6,
  "firstQuestion": { "id": "...", "orderIndex": 0, "questionText": "..." }
}
```

**Errors**
- `400 invalid_request` — missing `candidateEmail`, `jobDescriptionText`, or `resumeText`.
- `404 candidate_not_found` — no candidate record for that email; consent must be recorded first.
- `403 consent_required` — candidate exists but has no valid (non-withdrawn) consent covering the required type(s) for the requested mode.
- `502 question_generation_declined` — Claude declined the request (`stop_reason: "refusal"`).
- `502 question_generation_failed` — Claude's response didn't match the expected structured-output schema.

Writes an `audit_log` entry (`action: question_generated`) recording the model version used.

---

## `POST /api/interviews/:id/answers/transcribe`

STT: transcribes a spoken answer to text via the voice provider (see
`docs/DECISIONS.md`). **Does not persist a response** — it only returns the
transcript for the candidate to review/edit client-side before submitting it
through the existing `POST /api/interviews/:id/answers`. Only usable on an
interview created with `mode: "VOICE"`, and re-checks `voice_recording`
consent on every call (not just at interview creation) so a withdrawal takes
effect immediately.

**Request**: `multipart/form-data` with a single field `audio` (the recorded
clip, e.g. `audio/webm`).

**Response `200`**
```json
{ "text": "transcribed answer text" }
```

**Errors**
- `400 invalid_request` — no `audio` file attached.
- `404 interview_not_found`
- `409 interview_not_in_progress`
- `403 voice_not_enabled` — the interview was not started with `mode: "VOICE"`.
- `403 voice_consent_required` — candidate has no valid (non-withdrawn) `voice_recording` consent.
- `502 stt_failed` — the STT provider request failed.

Writes an `audit_log` entry (`action: voice_answer_transcribed`) recording the model version used. The audio itself is never persisted — only the resulting text (once the candidate submits it via the normal answers endpoint) is stored.

---

## `GET /api/interviews/:id/questions/:questionId/audio`

TTS: synthesizes the given question's text so it can be read aloud to the
candidate (see `docs/DECISIONS.md`). Available regardless of interview mode.

**Response `200`**: `audio/mpeg` binary body.

**Errors**
- `404 question_not_found` — no such question, or it doesn't belong to `:id`.
- `502 tts_failed` — the TTS provider request failed.

Not written to `audit_log` — TTS only reads back question text that was
already generated (and logged) at interview creation; it doesn't process any
candidate personal data.

---

## `POST /api/interviews/:id/answers`

Submits a candidate's answer to a question. Returns either the next question
or an end-of-interview signal. Marks the interview `COMPLETED` once every
question has a response.

**Request body**
```json
{ "questionId": "...", "responseText": "..." }
```

**Response `200` — more questions remain**
```json
{ "done": false, "nextQuestion": { "id": "...", "orderIndex": 1, "questionText": "..." } }
```

**Response `200` — interview complete**
```json
{ "done": true, "message": "Interview complete" }
```

**Errors**
- `400 invalid_request` — missing `questionId` or `responseText`.
- `404 interview_not_found`
- `409 interview_not_in_progress` — interview is not currently `IN_PROGRESS` (e.g. already completed).
- `404 question_not_found` — `questionId` doesn't exist or doesn't belong to this interview.
- `409 already_answered` — this question already has a recorded response.

---

## `POST /api/interviews/:id/evaluate`

Triggers evaluation of a completed interview's full transcript: calls Claude
with the JD + all question/answer pairs, and stores the structured score +
feedback.

**Request body:** none required.

**Response `201`**
```json
{
  "evaluation": {
    "id": "...",
    "interviewId": "...",
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
- `404 interview_not_found`
- `409 interview_not_complete` — not all questions have been answered yet (interview status isn't `COMPLETED`).
- `502 evaluation_declined` — Claude declined the request.
- `502 evaluation_failed` — Claude's response didn't match the expected structured-output schema.

Writes an `audit_log` entry (`action: evaluation_generated`) recording the model version used.

---

## `GET /api/interviews`

Lists all interviews, most recent first. Used by the reviewer dashboard
(Phase 3). Read-only — no auth yet (see `docs/DECISIONS.md`).

**Response `200`**
```json
{
  "interviews": [
    {
      "id": "...",
      "jobTitle": "Backend Engineer",
      "mode": "TEXT",
      "status": "COMPLETED",
      "createdAt": "...",
      "candidate": { "id": "...", "fullName": "Jane Doe", "email": "..." },
      "evaluation": { "overallScore": 78 } // or null if not yet evaluated
    }
  ]
}
```

---

## `GET /api/interviews/:id`

Fetches a single interview's full transcript and (if present) evaluation.
Used by the reviewer dashboard to show the Q&A transcript alongside the
score/feedback, and by the candidate-facing interview screen to recover
in-progress state on page reload.

**Response `200`**
```json
{
  "interview": {
    "id": "...",
    "jobTitle": "Backend Engineer",
    "jobDescriptionText": "...",
    "mode": "TEXT",
    "status": "COMPLETED",
    "createdAt": "...",
    "completedAt": "...",
    "candidate": { "id": "...", "fullName": "Jane Doe", "email": "..." }
  },
  "transcript": [
    { "questionId": "...", "orderIndex": 0, "questionText": "...", "responseText": "..." }
  ],
  "evaluation": { "id": "...", "overallScore": 78, "summaryText": "...", "scorecard": [...] } // or null
}
```

**Errors**
- `404 interview_not_found`

---

## Notes

- Every Claude call (question generation, evaluation) uses structured
  output (`output_config.format` with a Zod schema via `messages.parse()`)
  rather than free-text parsing, so a malformed response is caught and
  surfaced as `502`, not silently stored.
- Default model: `claude-opus-5` (overridable via `ANTHROPIC_MODEL`) — see
  `docs/DECISIONS.md` for the cost/quality tradeoff note.

# AI Interview Bot

An AI-driven candidate interview and evaluation tool for the Indian market:
LLM-generated interview questions from a job description + resume, a
text/voice candidate interview flow, LLM-based transcript evaluation, and a
structured feedback report. Comparable in scope to a single feature (Creya
AI) of the InterviewDesk platform — not a full ATS/interview platform.

## Scope

**In scope (v1)**
- LLM-driven question generation from JD + resume
- Text and voice candidate interviews
- LLM-based transcript evaluation
- Structured feedback report
- DPDP Act 2023 compliance: explicit consent capture, data minimization,
  breach reporting, audit logging of AI decisions, human-review path for
  candidates
- India-only, pilot scale (50–100 interviews over ~3 months)
- Enterprise org auth (email/OTP) and an internal credit ledger — one credit
  consumed per interview, manually granted by ops (Phase 4.5 — see
  `docs/DECISIONS.md`)

**Out of scope (v1)**
- AI avatar / video generation
- Self-serve payment/checkout for credits (billing UI, card processing,
  invoicing) — the credit ledger itself is in scope and built (Phase 4.5),
  but topping it up is ops-only, not self-serve
- Proctoring beyond basic tab-switch/fullscreen detection
- ATS integrations
- Marketing/landing-page features (sales channel already exists)
- Premature scale infrastructure: autoscaling, multi-region, microservices

## Tech stack

- **Backend:** Node.js + Express (or Next.js API routes if frontend is Next.js)
- **Frontend:** React (Next.js) + Tailwind
- **DB:** Postgres (managed — Supabase or Railway), simple schema
- **LLM:** Anthropic API (Claude) for question generation and evaluation
- **Voice:** STT/TTS via a single provider — OpenAI Whisper + TTS (decided in
  Phase 4 — see `docs/DECISIONS.md`)
- **Hosting:** Railway or Render
- **Auth:** Email/OTP, JWT session cookie (Phase 4.5 — see `docs/DECISIONS.md`)

See `CLAUDE.md` for full project rules and constraints.

## Running locally

Placeholder — filled in once backend/frontend scaffolding exists (Phase 1+).

```
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in the required keys before running.

## Project docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system diagram and data flow
- [`docs/API.md`](docs/API.md) — API reference (filled in as endpoints are built)
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — assumptions and decisions log
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) — DPDP compliance checklist
- [`TODO.md`](TODO.md) — phase checklist and current status

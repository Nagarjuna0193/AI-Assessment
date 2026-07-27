# Project: AI Interview Bot (India, DPDP-compliant, text+voice, no avatar at launch)

## What this is
An AI-driven candidate interview and evaluation tool — comparable to a single
feature (Creya AI) of the InterviewDesk platform, not the full platform.
Scope: LLM-driven question generation from JD + resume, text/voice candidate
interview, LLM-based transcript evaluation, structured feedback report.
Explicitly OUT of scope for v1: AI avatar, multi-tenant billing, proctoring
beyond basic tab-switch/fullscreen detection, ATS integrations.

## Target market & constraints
- India only for now. DPDP Act 2023 applies: explicit consent, data minimization,
  breach reporting, audit logging of AI decisions, human-review path for
  candidates. No EU AI Act-style mandatory bias audit yet, but design as if an
  audit could be requested — document decision logic and data flow from day one.
- Pilot scale: 50–100 interviews over ~3 months. Do NOT over-provision
  infrastructure for scale we don't have. No premature autoscaling,
  no premature multi-region, no premature microservices.
- Sales channel already exists — do not build marketing/landing-page features
  unless explicitly asked.

## Tech stack (do not deviate without asking)
- Backend: Node.js + Express (or Next.js API routes if frontend is Next.js)
- Frontend: React (Next.js), Tailwind
- DB: Postgres (managed, e.g. Supabase or Railway) — simple schema, no
  premature sharding
- LLM: Anthropic API (Claude) for question generation and evaluation
- Voice: STT/TTS via a single provider (decide in Phase 2, document the choice
  and why) — no avatar/video generation in v1
- Hosting: Railway or Render to start — cheap, simple, matches pilot scale
- Auth: simple email/OTP or magic link — no need for enterprise SSO at pilot
  stage

## Working rules for every session
1. Check `TODO.md` first. It tells you what phase we're in and what's done.
2. Stay inside the current phase's scope. If you notice something for a later
   phase, note it in `TODO.md` under "Parked for later" — do not build it now.
3. At the end of the phase: update `TODO.md`, update relevant docs
   (`README.md`, `docs/ARCHITECTURE.md`, `docs/API.md` as applicable),
   `git add -A && git commit -m "<phase>: <what changed>"`, and push.
4. Prefer editing/reading only the files relevant to the current task. Don't
   re-read the whole repo unless doing a genuine cross-cutting change.
5. Every assumption you make that isn't explicitly stated: write it down in
   `docs/DECISIONS.md` with a one-line reason. Don't silently assume.
6. DPDP compliance is not optional cleanup — build consent capture and audit
   logging as part of the feature that needs it, not as a bolt-on later.

## Repo structure (create if missing)
/
├── CLAUDE.md
├── TODO.md
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DECISIONS.md
│   └── COMPLIANCE.md
├── backend/
├── frontend/
└── .env.example
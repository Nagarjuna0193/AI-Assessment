# Decisions & Assumptions Log

Every assumption made that isn't explicitly stated in `CLAUDE.md` or by the
user, logged here with a one-line reason. Newest entries at the bottom.

| Date | Assumption/Decision | Reason |
|------|---------------------|--------|
| 2026-07-28 | Phase breakdown in `TODO.md` (Phase 0–8) is inferred from project scope in `CLAUDE.md`, since the full "prompt set" defining each phase wasn't provided verbatim. | Needed a concrete checklist to track progress against; phases follow the natural build order (setup -> backend/DB -> question gen -> text interview -> voice -> evaluation -> compliance hardening -> pilot deploy). Revise if the actual prompt set differs. |

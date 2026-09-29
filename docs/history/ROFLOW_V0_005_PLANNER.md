# RoFlow v0.005 — Today Planner & Bloom RNG Release Roadmap

RoFlow now keeps two planning layers inside the selected project:

1. **Today** — the current development-day focus list.
2. **Release Roadmap** — tracked work from the current Bloom RNG alpha state to first public release.

State is stored locally in `.roflow/planner.json` and is not committed with gameplay source.

## Today

The frontend supplies the local date as YYYY-MM-DD. Checkbox state survives restarts. On a new local date, the previous list is archived inside the planner store and a fresh focus list is seeded. Up to 31 previous day lists are retained.

The initial daily focus is based on current project priorities: RoFlow smoke test and sync hygiene, BR-005, BR-007, BR-002, verification of BR-008, desktop core-loop QA, and leaving main buildable.

## Release roadmap

The roadmap groups work into:

1. Stability
2. Runtime & Performance
3. UI & Inventory
4. Core Progression
5. Balance & Content
6. Technical Cleanup
7. QA
8. Release

BR-001, BR-003, BR-004 and BR-009 start checked because the current Phase 2A report records them as implemented and tested. RoFlow does not infer completion for the remaining product work.

## Versioning

RoFlow application version: **v0.005**.

Project checkpoint numbering remains independent: `v0.001`, `v0.002`, `v0.003`...

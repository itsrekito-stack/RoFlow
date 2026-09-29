# RoFlow Desktop Plan

## Goal

Turn the existing Bloom RNG development workflow into a Windows desktop workspace without breaking the current Bloom UI Studio.

RoFlow should eventually own the path:

**Prompt → AI change → GitHub → safe sync → local project → Rojo/Roblox Studio → verification**

UI editing is one workspace inside RoFlow, not the whole product.

## Phase 0 — Bootstrap (implemented)

- Separate `tools/roflow` Tauri 2 application.
- Native project-folder selection.
- Native Git status.
- Safe clean-worktree fast-forward sync.
- Native BloomUI.model.json read/write bridge with JSON validation.
- Project / Sync / UI Studio / Changes / Logs navigation.
- Existing browser editor remains untouched.

## Phase 1 — Embed UI Studio (implemented in v0.2)

Bundle the existing `tools/bloom-ui-editor` frontend inside RoFlow instead of opening it as a localhost website.

Preserve its hierarchy, inspector, canvas, preview scenes, geometry tools and authored model format. Do not fork the editor into a second independent implementation.

Replace browser File System Access calls with RoFlow commands while retaining the browser version as a fallback.

## Phase 2 — Port Safe AI Sync (implemented baseline in v0.2)

Move the existing Python bridge semantics into Rust:

- backup dirty BloomUI.model.json;
- preserve valid editor model;
- isolate model changes;
- stash unrelated changes;
- `git pull --ff-only`;
- restore unrelated work;
- three-way merge authored UI;
- preserve recovery artifacts on malformed JSON or conflicts.

Only after parity tests should the Python bridge become optional.

## Phase 3 — Git Workspace

Add:

- file diff;
- commit history;
- checkpoint button;
- commit creation;
- branch/status indicators;
- one-click restore to a user-selected checkpoint;
- explicit conflict UI.

Never silently discard dirty work.

## Phase 4 — Roblox Workflow

Add optional project tools:

- Rojo serve/build status;
- launch/open project helpers;
- Roblox Output/log import;
- deterministic project checks;
- test commands and reports.

Do not require Studio automation for ordinary Git/UI work.

## Phase 5 — AI Workspace

Provide a project-aware task surface that can show:

- current HEAD;
- last AI change;
- files changed;
- verification status;
- task/report history;
- links to GitHub commits/PRs.

AI remains source-controlled: generated changes go through Git and are reviewable/reversible.

## Safety principles

1. Current repository HEAD is source of truth.
2. RoFlow never overwrites dirty work without a recoverable copy.
3. No destructive Git reset as a normal sync path.
4. UI Studio keeps `BloomUI.model.json` as the authored source.
5. Roblox server authority/gameplay code is independent from the desktop tool.
6. Existing Bloom UI Studio remains usable until RoFlow reaches feature parity.

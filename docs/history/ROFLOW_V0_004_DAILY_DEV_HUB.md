# RoFlow v0.004 — Daily Dev Hub

RoFlow v0.004 turns the desktop shell into the day-to-day control surface for Bloom RNG development.

## Added

- Dashboard with project/Git/worktree/checkpoint/health/Rojo status.
- Safe DEV CYCLE: checkpoint → AI Sync → Health Check. It never commits or pushes automatically.
- Git Changes workspace with file list and unified diff preview.
- Explicit Commit button. Every commit first creates a recoverable RoFlow checkpoint.
- Local AI/Git task history stored under `.roflow/tasks.json`.
- Project Health Check for Git, BloomUI JSON, Rojo config, conflicts, index lock, source tree and Rojo executable.
- Native Rojo controls: status, serve start/stop, build `BloomRNG.rbxl`, open generated place.
- UI Studio remains lazy-loaded and now receives model-refresh messages after sync instead of forcing a full iframe reload.
- Session logs are capped to the newest 300 entries.

## Safety

RoFlow does not auto-commit or auto-push during DEV CYCLE.

Commit is explicit and creates a checkpoint before staging/committing.

Existing AI Sync merge/recovery behavior remains intact.

Restore behavior remains in the dedicated Backups window and does not rewind the current branch.

`.roflow` and `.recovery` remain excluded from normal project history.

## Versioning

Application version: **v0.004** (`0.0.4` in Tauri/Cargo/npm metadata).

Project checkpoints keep their own independent sequence: `v0.001`, `v0.002`, `v0.003`...

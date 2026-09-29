# RoFlow v0.007 — project-driven Planner

Planner defaults are now loaded from `tools/roflow/planner-defaults.json` inside the selected Bloom RNG project.

After one upgrade to v0.007, future roadmap/default-checkbox changes arrive through normal AI Sync and the existing post-sync `refresh()` call. Reinstalling RoFlow is no longer required just because planner defaults changed.

The Rust hardcoded planner remains as a fallback only when the project manifest is missing, malformed, or uses an unsupported schema version.

Local checkbox choices are still merged by task ID, and a shipped `done=true` can advance an existing local false state without erasing user-completed tasks.

#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
src=(ROOT/"src-tauri/src/lib.rs").read_text(encoding="utf-8")

def need(token,label):
    if token not in src:
        raise AssertionError(f"{label}: missing {token!r}")

need('fn git_env_path(path: &Path) -> String',"Git-compatible environment path helper")
need('raw.strip_prefix(r"\\\\?\\")',"Windows extended-path prefix stripping")
need('git_dir.join("roflow-backup.index.lock")',"RoFlow-owned temp lock path")
need('cleanup_roflow_temp_index(root)?',"backup cleanup before temp index use")
need('cleanup_roflow_temp_index(&root)?',"AI Sync cleanup before Git operations")
need('["restore", "--source=HEAD", "--staged", "--worktree", "--", &safe]',"conflict recovery compiles with &str path")
need('git(&root, &["reset", "--hard", "HEAD"])?',"partial stash apply rollback")
need('Partial stash changes were rolled back to HEAD and stash {} was kept intact.',"stash-preservation error copy")
need('RoFlow will not delete an index lock automatically.',"real Git index lock remains fail-closed")

if 'let temp_index_string = temp_index.to_string_lossy().to_string();' in src:
    raise AssertionError("Windows-unsafe canonical temp index path returned")
if '["restore", "--source=HEAD", "--staged", "--worktree", "--", safe]' in src:
    raise AssertionError("String passed where git() requires &str; RoFlow Windows build would fail")

sync=src[src.index("fn safe_ai_sync"):src.index("fn list_backups",src.index("fn safe_ai_sync"))]
if sync.index("cleanup_roflow_temp_index(&root)?") > sync.index("git_index_lock(&root)?"):
    raise AssertionError("RoFlow temp index cleanup must happen before sync lock validation")

need('if let Ok(configured_model) = primary_ui_model_path(&root)', "allow sync before first authored UI state")
need('if let (Some(primary_model), Some(model_path), Some(base_model)) =', "merge only when prior UI model exists")
if 'let primary_model = primary_ui_model_path(&root)?;' in sync:
    raise AssertionError("AI Sync must not require a configured UI model before pulling a new manifest")
if sync.index("if let Ok(configured_model) = primary_ui_model_path(&root)") > sync.index('git(&root, &["pull", "--ff-only"])'):
    raise AssertionError("Only existing local UI models may be captured before git pull")

print("RoFlow Safe AI Sync contract: PASS")
print("Windows-safe GIT_INDEX_FILE, RoFlow temp-lock cleanup, conflict recovery and stash-preserving rollback are guarded.")

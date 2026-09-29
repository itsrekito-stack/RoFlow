use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    env,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const MODEL_PATH: &str = "src/StarterGui/BloomUI.model.json";
const LOADING_MODEL_PATH: &str = "src/ReplicatedFirst/BloomLoadingTemplate.model.json";
const PROJECT_MANIFEST_PATH: &str = "roflow.project.json";
const LEGACY_PLANNER_DEFAULTS_PATH: &str = "tools/roflow/planner-defaults.json";
const UPDATE_REMOTE_REF: &str = "refs/remotes/roflow-updater/roflow-update";
const UPDATE_SOURCE_URL: &str = "https://github.com/itsrekito-stack/RoFlow.git";
const UPDATE_INSTALLER_NAME: &str = "RoFlow-latest.exe";

#[derive(Default)]
struct AppState {
    project_root: Mutex<Option<PathBuf>>,
    rojo_child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectStatus {
    root: String,
    project_id: String,
    display_name: String,
    branch: String,
    head: String,
    subject: String,
    dirty: bool,
    changes: Vec<String>,
    model_exists: bool,
    planner_defaults_path: String,
    build_file: String,
    runtime_probe_enabled: bool,
    release_gate_task_ids: Vec<String>,
    ui_states: Vec<UiStateManifest>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    changed: bool,
    head: String,
    subject: String,
    dirty: bool,
    stashed: bool,
    restored: bool,
    model_merged: bool,
    recovery_backup: String,
    backup_version: String,
    recovered_conflicts: Vec<String>,
    conflict_recoveries: Vec<String>,
    preserved_stashes: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    version: String,
    snapshot_sha: String,
    source_head: String,
    created_at: u64,
    title: String,
    summary: String,
    changes: Vec<String>,
    commits: Vec<String>,
    automatic: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct BackupStore {
    #[serde(default)]
    project_id: String,
    backups: Vec<BackupEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    restored_version: String,
    safety_version: String,
    status: ProjectStatus,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskEntry {
    id: String,
    created_at: u64,
    kind: String,
    title: String,
    summary: String,
    head_before: String,
    head_after: String,
    changed_files: Vec<String>,
    backup_version: String,
    result: String,
}

#[derive(Default, Serialize, Deserialize)]
struct TaskStore {
    #[serde(default)]
    project_id: String,
    tasks: Vec<TaskEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannerTask {
    id: String,
    group: String,
    title: String,
    detail: String,
    done: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannerStore {
    #[serde(default)]
    project_id: String,
    today_date: String,
    today: Vec<PlannerTask>,
    roadmap: Vec<PlannerTask>,
    today_history: HashMap<String, Vec<PlannerTask>>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiStateManifest {
    #[serde(default)]
    id: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    root: String,
    #[serde(default)]
    model_path: String,
    #[serde(default)]
    icon_asset_id: String,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectManifest {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    planner_defaults_path: String,
    #[serde(default)]
    build_file: String,
    #[serde(default)]
    runtime_probe_enabled: bool,
    #[serde(default)]
    release_gate_task_ids: Vec<String>,
    #[serde(default)]
    ui_states: Vec<UiStateManifest>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlannerDefaults {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    today: Vec<PlannerTask>,
    #[serde(default)]
    roadmap: Vec<PlannerTask>,
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitChange {
    status: String,
    path: String,
    staged: bool,
    untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitResult {
    head: String,
    subject: String,
    backup_version: String,
    status: ProjectStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthItem {
    name: String,
    ok: bool,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthReport {
    passed: usize,
    total: usize,
    checks: Vec<HealthItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RojoStatus {
    available: bool,
    running: bool,
    path: String,
    version: String,
    project_file: bool,
    build_file: bool,
    build_file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProbeReport {
    available: bool,
    path: String,
    modified_at: u64,
    milestones: Vec<String>,
    evidence: Vec<String>,
    latest_server_checkpoint: String,
    latest_client_checkpoint: String,
    latest_persistence_join: String,
    latest_persistence_leave: String,
    persistence_verdict: String,
    checkpoint_minutes: Vec<u32>,
    logs_scanned: usize,
    lines: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    success: bool,
    output: String,
    path: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateManifest {
    version: String,
    installer_version: String,
    source_sha: String,
    sha256: String,
    filename: String,
    published_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    available: bool,
    current_version: String,
    current_build: String,
    latest_version: String,
    latest_build: String,
    installer_version: String,
    published_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallResult {
    source_sha: String,
    installer_path: String,
}


#[cfg(target_os = "windows")]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_command: &mut Command) {}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(root);
    hide_console(&mut command);
    let out = command
        .output()
        .map_err(|e| format!("Failed to start git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn safe_manifest_relative_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(trimmed.replace('\\', "/"))
}

fn fallback_project_id(root: &Path) -> String {
    let source = git(root, &["config", "--get", "remote.origin.url"])
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    let digest = format!("{:x}", Sha256::digest(source.as_bytes()));
    format!("project-{}", &digest[..16])
}

fn default_project_name(root: &Path) -> String {
    root.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Project")
        .to_string()
}

fn default_build_file(root: &Path) -> String {
    let raw_name = fs::read_to_string(root.join("default.project.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.get("name").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| default_project_name(root));

    let mut out = String::new();
    let mut previous_separator = false;
    for ch in raw_name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
            previous_separator = false;
        } else if !previous_separator {
            out.push('_');
            previous_separator = true;
        }
    }
    let stem = out.trim_matches('_');
    format!("{}.rbxl", if stem.is_empty() { "Project" } else { stem })
}

fn project_manifest(root: &Path) -> ProjectManifest {
    let mut manifest = fs::read_to_string(root.join(PROJECT_MANIFEST_PATH))
        .ok()
        .and_then(|text| serde_json::from_str::<ProjectManifest>(&text).ok())
        .filter(|value| value.schema_version == 1)
        .unwrap_or_default();

    manifest.schema_version = 1;
    if manifest.project_id.trim().is_empty() {
        manifest.project_id = fallback_project_id(root);
    }
    if manifest.display_name.trim().is_empty() {
        manifest.display_name = default_project_name(root);
    }

    manifest.planner_defaults_path =
        safe_manifest_relative_path(&manifest.planner_defaults_path).unwrap_or_default();
    if manifest.planner_defaults_path.is_empty()
        && root.join(LEGACY_PLANNER_DEFAULTS_PATH).is_file()
    {
        manifest.planner_defaults_path = LEGACY_PLANNER_DEFAULTS_PATH.to_string();
    }

    manifest.build_file = safe_manifest_relative_path(&manifest.build_file)
        .unwrap_or_else(|| default_build_file(root));
    manifest.release_gate_task_ids.retain(|id| {
        !id.trim().is_empty()
            && id.len() <= 96
            && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c))
    });
    manifest.release_gate_task_ids.truncate(32);

    manifest.ui_states.retain(|state| {
        !state.id.trim().is_empty()
            && state.id.len() <= 64
            && !state.root.trim().is_empty()
            && state.root.len() <= 128
    });
    for state in &mut manifest.ui_states {
        state.id = state.id.trim().to_string();
        if state.label.trim().is_empty() {
            state.label = state.id.clone();
        } else {
            state.label = state.label.trim().chars().take(64).collect();
        }
        state.root = state.root.trim().chars().take(128).collect();
        state.model_path = safe_manifest_relative_path(&state.model_path)
            .unwrap_or_else(|| MODEL_PATH.to_string());
        state.icon_asset_id = state
            .icon_asset_id
            .chars()
            .filter(|c| c.is_ascii_digit())
            .take(20)
            .collect();
    }
    manifest.ui_states.truncate(32);
    manifest
}

fn allowed_ui_model_paths(root: &Path) -> BTreeSet<String> {
    let manifest = project_manifest(root);
    let mut paths = BTreeSet::new();

    for state in manifest.ui_states {
        if let Some(path) = safe_manifest_relative_path(&state.model_path) {
            paths.insert(path);
        }
    }

    if paths.is_empty() {
        if root.join(MODEL_PATH).is_file() {
            paths.insert(MODEL_PATH.to_string());
        }
        if root.join(LOADING_MODEL_PATH).is_file() {
            paths.insert(LOADING_MODEL_PATH.to_string());
        }
    }
    paths
}

fn primary_ui_model_path(root: &Path) -> Result<String, String> {
    let manifest = project_manifest(root);
    for state in manifest.ui_states {
        if let Some(path) = safe_manifest_relative_path(&state.model_path) {
            return Ok(path);
        }
    }

    if root.join(MODEL_PATH).is_file() {
        return Ok(MODEL_PATH.to_string());
    }
    if root.join(LOADING_MODEL_PATH).is_file() {
        return Ok(LOADING_MODEL_PATH.to_string());
    }

    Err("No authored UI model is configured for this project".into())
}

fn resolve_ui_model_path(root: &Path, requested: Option<String>) -> Result<String, String> {
    let allowed = allowed_ui_model_paths(root);
    let raw = match requested {
        Some(value) if !value.trim().is_empty() => value,
        _ => primary_ui_model_path(root)?,
    };
    let safe = safe_manifest_relative_path(&raw)
        .ok_or_else(|| format!("Unsafe UI model path: {raw}"))?;

    if !allowed.contains(&safe) {
        return Err(format!(
            "UI model path is not declared by this project: {safe}"
        ));
    }
    Ok(safe)
}

fn json_tree_has_name(value: &Value, wanted: &str) -> bool {
    if value
        .get("Name")
        .and_then(Value::as_str)
        .map(|name| name == wanted)
        .unwrap_or(false)
    {
        return true;
    }

    value
        .get("Children")
        .and_then(Value::as_array)
        .map(|children| children.iter().any(|child| json_tree_has_name(child, wanted)))
        .unwrap_or(false)
}

fn git_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(root);
    for (key, value) in envs {
        command.env(key, value);
    }
    hide_console(&mut command);
    let out = command.output().map_err(|e| format!("Failed to start git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_dir_path(root: &Path) -> Result<PathBuf, String> {
    let raw = git(root, &["rev-parse", "--git-dir"])?;
    let path = PathBuf::from(raw);
    Ok(if path.is_absolute() { path } else { root.join(path) })
}

fn git_env_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", stripped);
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    raw.to_string()
}

fn roflow_temp_index_paths(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let git_dir = git_dir_path(root)?;
    Ok((
        git_dir.join("roflow-backup.index"),
        git_dir.join("roflow-backup.index.lock"),
    ))
}

fn cleanup_roflow_temp_index(root: &Path) -> Result<(), String> {
    let (index, lock) = roflow_temp_index_paths(root)?;
    if lock.exists() {
        fs::remove_file(&lock)
            .map_err(|e| format!("Failed to remove stale RoFlow backup lock {}: {e}", lock.display()))?;
    }
    if index.exists() {
        fs::remove_file(&index)
            .map_err(|e| format!("Failed to remove stale RoFlow backup index {}: {e}", index.display()))?;
    }
    Ok(())
}

fn git_index_lock(root: &Path) -> Result<Option<String>, String> {
    let path = git_dir_path(root)?.join("index.lock");
    Ok(path.is_file().then(|| path.to_string_lossy().to_string()))
}

fn unmerged_paths(root: &Path) -> Result<Vec<String>, String> {
    let output = git(root, &["diff", "--name-only", "--diff-filter=U"])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn find_roflow_sync_stash(root: &Path) -> Result<Option<(String, String)>, String> {
    let output = git(root, &["stash", "list", "--format=%gd%x00%H%x00%s"])?;
    for line in output.lines() {
        let mut parts = line.splitn(3, '\0');
        let reference = parts.next().unwrap_or("").trim();
        let sha = parts.next().unwrap_or("").trim();
        let subject = parts.next().unwrap_or("");
        if !reference.is_empty() && !sha.is_empty() && subject.contains("RoFlow AI SYNC") {
            return Ok(Some((reference.to_string(), sha.to_string())));
        }
    }
    Ok(None)
}

fn backup_conflict_versions(root: &Path, stash_spec: &str, paths: &[String]) -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let relative = format!(".recovery/ai-sync-conflicts-{stamp}");
    let base = root.join(&relative);

    for raw in paths {
        let safe = clean_relative_path(raw)?;
        let local = git_blob(root, &format!("{stash_spec}:{safe}"))
            .map_err(|e| format!("Could not preserve local conflict copy for {safe}: {e}"))?;
        let local_path = base.join("local").join(safe);
        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&local_path, local).map_err(|e| e.to_string())?;

        if let Ok(remote) = git_blob(root, &format!("HEAD:{safe}")) {
            let remote_path = base.join("remote").join(safe);
            if let Some(parent) = remote_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(remote_path, remote).map_err(|e| e.to_string())?;
        }

        if let Ok(base_bytes) = git_blob(root, &format!("{stash_spec}^1:{safe}")) {
            let base_path = base.join("base").join(safe);
            if let Some(parent) = base_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(base_path, base_bytes).map_err(|e| e.to_string())?;
        }
    }

    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let manifest = format!(
        "RoFlow preserved a failed AI Sync stash restore.\nStash: {stash_spec}\nConflicts:\n{}\n",
        paths.iter().map(|path| format!("- {path}")).collect::<Vec<_>>().join("\n")
    );
    fs::write(base.join("README.txt"), manifest).map_err(|e| e.to_string())?;
    Ok(relative.replace('\\', "/"))
}

fn recover_roflow_conflicts(root: &Path, stash_spec: &str, paths: &[String]) -> Result<String, String> {
    if paths.is_empty() {
        return Ok(String::new());
    }
    let recovery = backup_conflict_versions(root, stash_spec, paths)?;
    for raw in paths {
        let safe = clean_relative_path(raw)?;
        git(root, &["restore", "--source=HEAD", "--staged", "--worktree", "--", &safe])
            .map_err(|e| format!("Conflict backup exists at {recovery}, but failed to restore {safe} to HEAD: {e}"))?;
    }
    let remaining = unmerged_paths(root)?;
    if !remaining.is_empty() {
        return Err(format!(
            "Conflict backup exists at {recovery}, but Git still reports unresolved paths: {}",
            remaining.join(", ")
        ));
    }
    Ok(recovery)
}

fn roflow_build_sha() -> &'static str {
    option_env!("ROFLOW_BUILD_SHA").unwrap_or("dev")
}

fn fetch_update_manifest(root: &Path) -> Result<UpdateManifest, String> {
    git(
        root,
        &[
            "fetch",
            UPDATE_SOURCE_URL,
            "+refs/heads/roflow-update:refs/remotes/roflow-updater/roflow-update",
            "--force",
            "--quiet",
        ],
    )?;
    let raw = git(root, &["show", &format!("{UPDATE_REMOTE_REF}:latest.json")])?;
    let manifest: UpdateManifest =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid RoFlow update manifest: {e}"))?;
    if manifest.filename != UPDATE_INSTALLER_NAME {
        return Err("RoFlow update manifest points to an unexpected installer".into());
    }
    if manifest.source_sha.len() != 40
        || !manifest.source_sha.chars().all(|c| c.is_ascii_hexdigit())
        || manifest.sha256.len() != 64
        || !manifest.sha256.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("RoFlow update manifest failed validation".into());
    }
    Ok(manifest)
}

fn git_blob(root: &Path, spec: &str) -> Result<Vec<u8>, String> {
    let mut command = Command::new("git");
    command.args(["show", spec]).current_dir(root);
    hide_console(&mut command);
    let out = command
        .output()
        .map_err(|e| format!("Failed to start git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Failed to read RoFlow update installer from Git".into()
        } else {
            stderr
        });
    }
    Ok(out.stdout)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn ps_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn roflow_dir(root: &Path) -> PathBuf {
    root.join(".roflow")
}

fn backup_store_path(root: &Path) -> PathBuf {
    roflow_dir(root).join("backups.json")
}

fn task_store_path(root: &Path) -> PathBuf {
    roflow_dir(root).join("tasks.json")
}

fn planner_store_path(root: &Path) -> PathBuf {
    roflow_dir(root).join("planner.json")
}

fn planner_task(id: &str, group: &str, title: &str, detail: &str, done: bool) -> PlannerTask {
    PlannerTask {
        id: id.to_string(),
        group: group.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        done,
    }
}

fn default_today_tasks() -> Vec<PlannerTask> {
    vec![
        planner_task("today-br005","Runtime","Finish BR-005 snapshot/state synchronization optimization","Implemented and covered by the gameplay CI state-revision assertions.",true),
        planner_task("today-br007","Runtime","Make Workshop persistent while open (BR-007)","Implemented: WorkshopRuntime remains mounted and patches node state in place.",true),
        planner_task("today-br002","UI / Inventory","Resolve Inventory V2 / SeedSatchel ownership (BR-002)","Implemented: SeedSatchel explicitly routes to Inventory V2 and FieldGuide stays separate.",true),
        planner_task("today-br008-verify","Runtime","Fix roulette request/session race (BR-008)","Implemented with RequestId, RollSession and generation guards; automated assertions are green.",true),
        planner_task("today-br006","Runtime","Scale public bee/activity replication (BR-006)","Implemented with per-recipient visibility/radius filtering and bounded cadence.",true),
        planner_task("today-inventory-plant","UI / Inventory","Route Inventory planting through physical garden pads","Implemented: inventory selection now hands off to the proximity-gated garden PlantPicker flow.",true),
        planner_task("today-core-contract","QA","Add automated core-loop contract acceptance","Guard roll → inventory → garden → bees → hive/Workshop wiring in gameplay CI. This supplements but does not pretend to be a Roblox Studio playtest.",true),
        planner_task("today-playtest","QA","Studio-only core-loop acceptance at 1366×768 and 1280×720","Runtime-only acceptance remains: roll → inventory → garden → bees → hive → Workshop, including real input/focus and visual behavior.",false),
        planner_task("today-stable-main","QA","Record blockers and leave main buildable","Saved checkpoint checkpoint/roflow-saved-progress-2026-09-25-2000; gameplay CI was green at 5c74bbf. Remaining runtime-only work is split into smaller acceptance stages.",true),
    ]
}

fn default_roadmap_tasks() -> Vec<PlannerTask> {
    vec![
        planner_task("release-br001","1 · Stability","Persistence lifecycle / final-save safety (BR-001)","Confirmed in Phase 2A: serialized persistence lifecycle, bounded retries and fail-closed final release.",true),
        planner_task("release-br004","1 · Stability","Season transaction and leave/shutdown ordering (BR-004)","Confirmed in Phase 2A: transaction outcomes and close ordering use the DataService lifecycle owner.",true),
        planner_task("release-br003","1 · Stability","Workshop respec / planted progression safety (BR-003)","Confirmed in Phase 2A: destructive capacity collapse is blocked and bee ownership is preserved.",true),
        planner_task("release-br009","1 · Stability","Profile schema invariants (BR-009)","Confirmed in Phase 2A: domain validation, archive preservation and malformed profile fail-safe behavior.",true),
        planner_task("release-studio-persistence-a","1 · Stability","Studio persistence: join / leave / rejoin","Verify one profile loads once, saves on leave, and returns with the same inventory/progression.",false),
        planner_task("release-studio-persistence-b","1 · Stability","Studio persistence: throttling / failure paths","Exercise DataStore refusal/throttling and confirm fail-closed behavior with no silent progress loss.",false),
        planner_task("release-studio-persistence-c","1 · Stability","Studio persistence: shutdown / session ownership","Test BindToClose/server shutdown and stale-session ownership ordering.",false),

        planner_task("release-br005","2 · Runtime & Performance","Revision-aware UI state flow (BR-005)","Coalesce state pushes and avoid full profile/UI snapshot rebuilds on every request and one-second tick.",true),
        planner_task("release-br007","2 · Runtime & Performance","Persistent Workshop GUI lifecycle (BR-007)","Keep the full-screen Workshop mounted while open and patch node state without rebinding the entire tree.",true),
        planner_task("release-br006","2 · Runtime & Performance","Scale public bee/activity replication (BR-006)","Use recipient relevance / spatial filtering and bounded update frequency instead of full global payloads.",true),
        planner_task("release-br008","2 · Runtime & Performance","Close or fix roulette lifecycle BR-008","Reproduce on current main first. Add request/generation correlation only if the race still exists.",true),
        planner_task("release-low-end-a","2 · Runtime & Performance","Low-end profile: 10-minute baseline","Record client/server frame time, Lua memory and replication during normal core-loop play.",false),
        planner_task("release-low-end-b","2 · Runtime & Performance","Low-end profile: identify top hotspots","Capture the largest UI, replication and Lua-time offenders before changing code.",false),
        planner_task("release-low-end-c","2 · Runtime & Performance","Low-end profile: optimize and re-measure","Fix only measured hotspots, then compare against the baseline.",false),

        planner_task("release-br002","3 · UI & Inventory","Resolve Inventory V2 menu ownership (BR-002)","Make SeedSatchel / Inventory V2 / FieldGuide responsibilities explicit against the actual authored UI model.",true),
        planner_task("release-inventory-actions","3 · UI & Inventory","QA every Inventory V2 action","Verify category/search/sort/filter, Plant, Favorite, Protect, Dissolve, Mastery and Bee equip/unequip states.",true),
        planner_task("release-inventory-plant","3 · UI & Inventory","Fix or clearly surface Garden proximity for Plant","Inventory planting currently depends on physical garden proximity; route or explain the action so it is not misleading.",true),
        planner_task("release-hud-1080","3 · UI & Inventory","HUD acceptance: 1920×1080","Automated authored-layout acceptance is green: key HUD regions stay on-screen, non-overlapping and primary hit targets remain >=44 px.",true),
        planner_task("release-hud-1366","3 · UI & Inventory","HUD acceptance: 1366×768","Automated authored-layout acceptance is green: no key HUD clipping/overlap and primary hit targets remain >=44 px.",true),
        planner_task("release-hud-1280","3 · UI & Inventory","HUD acceptance: 1280×720","Automated authored-layout acceptance is green after moving MenuDock fully on-screen and separating RollHUD from RollButton.",true),
        planner_task("release-tutorial-a","3 · UI & Inventory","Tutorial: verify step → target mapping","Verified by CI: every configured tutorial target maps to a current screen target, world target or release sector.",true),
        planner_task("release-tutorial-b","3 · UI & Inventory","Tutorial: keep arrows and indicators on-screen","Verified by edge-biased clamp tests at 1366×768 and 1280×720; screen target/callout bounds remain inside SafeRoot.",true),
        planner_task("release-tutorial-c","3 · UI & Inventory","Tutorial: replay / skip / resume","Verified contracts: replay is presentation-only, skip follows TutorialConfig length, and resume reads persisted Tutorial.Step.",true),
        planner_task("release-workshop-ui-a","3 · UI & Inventory","Workshop UI: fullscreen exclusivity","Verified by CI: Workshop focus hides conflicting HUD, stops roulette/auto state, and blocks opening other menus until close.",true),
        planner_task("release-workshop-ui-b","3 · UI & Inventory","Workshop UI: pan and zoom acceptance","Verified contracts: LMB background drag pans a clamped canvas; wheel zoom is bounded and captured only while Workshop is active.",true),
        planner_task("release-workshop-ui-c","3 · UI & Inventory","Workshop UI: node states and costs","Verified: server payload redacts hidden costs and drives revealed/available/owned states; client renders selected/hidden state from that payload.",true),
        planner_task("release-br010","3 · UI & Inventory","Clarify world gate / shrine feedback (BR-010)","Make unlock requirements and blocked interactions understandable in the physical world.",true),
        planner_task("release-br013","3 · UI & Inventory","Remove preview/runtime drift (BR-013)","Keep mock editor data clearly separate from runtime and remove stale/Russian player-facing preview labels.",true),

        planner_task("release-core-loop","4 · Core Progression","Validate the complete progression loop","Verified by deterministic core progression reachability checks through Season Turn; Studio runtime acceptance remains separate.",true),
        planner_task("release-roll-loop","4 · Core Progression","Finalize Roll / Bloom / pity loop","Verified: server-authoritative reward/pity/Bloom contracts, bounded pity/reserve, config-driven meter and roulette-only normal reward presentation.",true),
        planner_task("release-garden","4 · Core Progression","Finalize Garden progression and synergies","Verified and hardened: config-driven capacity, protected replacement, centralized flower XP/level carry-over, mutation/synergy paths and dissolve ownership invariants.",true),
        planner_task("release-bees","4 · Core Progression","Finalize Bee traits, abilities and equipment","Implemented: declared trait/passive bonuses and release-bee active abilities now execute server-side; stale unequipped states are pruned and equipment ownership remains validated.",true),
        planner_task("release-bee-mastery","4 · Core Progression","Give Bee Mastery a clear player-facing reward","Implemented: 10-level server-authoritative mastery ladder, runtime bonuses, XP multipliers, Inventory V2 progress and level-up feedback.",true),
        planner_task("release-hive-locations","4 · Core Progression","Finalize Hive and location progression","Implemented: Hive 1→8 keeps hand-tuned costs, Hive 9+ continues on the endless cost curve and keeps awarding Workshop Points; world interactions remain server-authoritative.",true),
        planner_task("release-workshop-tree","4 · Core Progression","Finalize the Workshop progression tree","Implemented: 42 effect-backed nodes span Hive 1–5, parent/cost gates are server-authoritative, Legacy remains permanent and both respec/Season refunds follow configured node costs.",true),
        planner_task("release-quests-trials","4 · Core Progression","Finish quests, activities and trials","Implemented: 3 base Season trials + 5 LEGACY_4-gated advanced trials, server-owned expiry/shrine checks, bounded activity tokens and persistent/repeat rewards are covered by CI.",true),
        planner_task("release-season","4 · Core Progression","Finish Season / Legacy loop","Implemented: revision-bound two-step Season transaction, config-driven reset, capped Legacy Bee memory, transient trial/activity cleanup, Ancient Nectar/keepsakes and retained-card behavior are covered by CI.",true),

        planner_task("release-economy","5 · Balance & Content","Balance currency sources and sinks","Verified by deterministic guardrails: every release currency has live sources/sinks, early Workshop affordability is bounded, Coin coverage stays finite, Legacy Nectar spans multiple Seasons and Bloom/pity cadence stays in target ranges.",true),
        planner_task("release-pacing","5 · Balance & Content","Balance early / mid / late progression pacing","Verified with deterministic pacing anchors: Hive2 remains fast, world gates land at Hive2/4/6, Workshop reaches Hive5, Season at Hive8, Bee Mastery stays long-form and Legacy spans multiple Seasons.",true),
        planner_task("release-rarities","5 · Balance & Content","Tune rarity and duplicate pacing","Implemented: natural rarity weights stay intact, discovery pity is capped at Epic so it supports Season progression without guaranteeing Legendary/Mythic/Celestial, and rarity/pity/duplicate guardrails are covered by CI.",true),
        planner_task("release-content-a","5 · Balance & Content","Release content: freeze flowers and bees","Frozen: 12 shipping flowers + 13 shipping bees, explicit final rarities/ability IDs, stable bee icons and flower fallback icon policy guarded by the release content lock.",true),
        planner_task("release-content-b","5 · Balance & Content","Release content: freeze locations and trials","Frozen: 3 locations with Hive/prerequisite/activity roles, 12 activity IDs, and the 3 base + 5 advanced trial split are manifest-backed and CI-guarded.",true),
        planner_task("release-content-c","5 · Balance & Content","Release content: freeze Workshop branches","Frozen: 7 shipping Workshop branches × 6 nodes; the exact 42 effect-backed node IDs are derived from the release manifest and CI-guarded.",true),
        planner_task("release-content-d","5 · Balance & Content","Release content: freeze IDs and configs","Completed: ReleaseContentManifest is the single v1 set contract for rarities, collectibles, world/trials, Workshop, Season cards and Journey IDs; CI blocks drift.",true),
        planner_task("release-sinks-a","5 · Balance & Content","Endgame sinks: duplicate flowers and bees","Completed: flowers retain dissolve + mastery value; free bee duplicates can be safely dismantled into Petal Dust without consuming equipped or final copies.",true),
        planner_task("release-sinks-b","5 · Balance & Content","Endgame sinks: Coins and Petal Dust","Verified: non-Legacy Workshop repurchases create repeatable 3,780-Coin / 126-Petal-Dust seasonal sinks, while Petal Dust also remains a Flower Mastery sink.",true),
        planner_task("release-sinks-c","5 · Balance & Content","Endgame sinks: Ancient Nectar / post-Season","Completed: Ancient Nectar funds permanent Legacy first; after all six Legacy nodes, 1 Nectar can be distilled into 10 Petal Dust as a repeatable server-authoritative sink.",true),

        planner_task("release-br011","6 · Technical Cleanup","Remove FlowersConfig duplication (BR-011)","Use one authoritative initialization table instead of repeating derived metadata and weights.",true),
        planner_task("release-br012","6 · Technical Cleanup","Document and unify config authority (BR-012)","Remove or document literal effect values that can drift from Workshop/config definitions.",true),
        planner_task("release-legacy","6 · Technical Cleanup","Remove dead legacy routes and scripts","Completed: unused React/ReactRoblox vendor path and wrapper removed; active map/migration compatibility paths retained intentionally.",true),
        planner_task("release-remote-security","6 · Technical Cleanup","Final remote validation/security pass","Completed: transport schemas, scalar/type/range validation and server-authority guards are covered by gameplay CI.",true),

        planner_task("release-fresh-profile-a","7 · QA","Fresh profile: onboarding smoke","Spawn, get starter bee, complete tutorial opening and first roll without manual fixes.",false),
        planner_task("release-fresh-profile-b","7 · QA","Fresh profile: early core loop","Deterministic fresh-profile reachability is green through Hive 2, first Workshop affordability, garden capacity growth and Sunny Orchard.",true),
        planner_task("release-fresh-profile-c","7 · QA","Fresh profile: midgame reachability","Deterministic progression checks prove Crystal/Twilight Hive gates, required flower capacity and trial events remain reachable.",true),
        planner_task("release-returning-profile-a","7 · QA","Legacy profile: migrate representative snapshots","Three representative legacy fixtures now migrate through the real ProfileSchema in the persistence harness.",true),
        planner_task("release-returning-profile-b","7 · QA","Legacy profile: verify retained ownership","Migration assertions cover mapped flowers/mastery, Workshop points, sectors, archives and unknown-copy compensation without silent loss.",true),
        planner_task("release-returning-profile-c","7 · QA","Legacy profile: save and reload migrated state","Persistence harness releases each migrated fixture and rejoins the same user; the migrated profile must round-trip identically.",true),
        planner_task("release-multiplayer-a","7 · QA","Multiplayer: shared world state","Verify sectors, Server Bloom, activities and shared progression behavior with 2+ players.",false),
        planner_task("release-multiplayer-b","7 · QA","Multiplayer: public replication","Verify nearby bees/tokens replicate correctly and respect player visibility settings.",false),
        planner_task("release-multiplayer-c","7 · QA","Multiplayer: leave / join during activity","Test owner/visitor disconnects while activities, trials and public replication are active.",false),
        planner_task("release-resolutions-a","7 · QA","Input acceptance: mouse / keyboard","Check focus, drag, wheel and click behavior across all release menus.",false),
        planner_task("release-resolutions-b","7 · QA","Resolution acceptance: desktop matrix","Automated authored-layout matrix is green at 1920×1080, 1366×768 and 1280×720.",true),
        planner_task("release-session-a","7 · QA","Session matrix: normal leave / rejoin","Verify no duplicate grants, stale locks or lost progression after a normal reconnect.",false),
        planner_task("release-session-b","7 · QA","Session matrix: interrupted disconnect","Disconnect during roll/activity/trial/menu states and verify safe recovery.",false),
        planner_task("release-session-c","7 · QA","Session matrix: server shutdown","Deterministic persistence harness covers BindToClose, active transaction shutdown, concurrent profile release, bounded timeout and final-save ordering.",true),
        planner_task("release-long-session-a","7 · QA","Soak: 15-minute functional pass","Watch for duplicated signals, stuck popups, stale activities and state drift.",false),
        planner_task("release-long-session-b","7 · QA","Soak: 30-minute memory / replication pass","Compare Lua memory, UI instance count and replication behavior against baseline.",false),
        planner_task("release-long-session-c","7 · QA","Soak: 60-minute release soak","Run the final long session after blocker fixes and record remaining anomalies.",false),
        planner_task("release-bug-zero","7 · QA","Reach zero known release-blocking bugs","Every remaining blocker must have a reproduction, owner/status and verified fix or an explicit release decision.",false),

        planner_task("release-clean-build","8 · Release","Build release candidate from a clean clone","GitHub clean checkout installs Rojo 7.7.0, builds BloomRNG.rbxl successfully, then completes the full gameplay regression suite.",true),
        planner_task("release-publish-config","8 · Release","Verify Roblox publish / API / DataStore configuration","Confirm production place, API access, DataStore names, permissions and no TEST store is used by the release build.",false),
        planner_task("release-store-page","8 · Release","Prepare game icon, thumbnails and description","Ship a coherent Roblox store page that accurately represents the release build.",false),
        planner_task("release-private-alpha","8 · Release","Run a private release-candidate playtest","Have real players complete onboarding/core progression and collect only reproducible blockers.",false),
        planner_task("release-rc-fixes","8 · Release","Fix release-candidate blockers and freeze features","After the RC test, stop adding systems and only fix confirmed release blockers/regressions.",false),
        planner_task("release-final-checkpoint","8 · Release","Create final checkpoint and release commit/tag","Record the exact source state used for the public build so rollback and hotfixes are straightforward.",false),
        planner_task("release-publish","8 · Release","Publish Bloom RNG","Build/publish the verified release candidate and perform an immediate live smoke test.",false),
        planner_task("release-monitor","8 · Release","Monitor the first live sessions","Watch errors, persistence failures, progression blockers and economy anomalies; prepare a small hotfix only if needed.",false),
    ]
}

fn project_planner_defaults(root: &Path) -> PlannerDefaults {
    let manifest = project_manifest(root);
    if !manifest.planner_defaults_path.is_empty() {
        let path = root.join(&manifest.planner_defaults_path);
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(defaults) = serde_json::from_str::<PlannerDefaults>(&text) {
                if defaults.schema_version == 1 {
                    return defaults;
                }
            }
        }
    }

    PlannerDefaults {
        schema_version: 1,
        today: Vec::new(),
        roadmap: Vec::new(),
    }
}

fn merge_planner_tasks(existing: &[PlannerTask], defaults: Vec<PlannerTask>) -> Vec<PlannerTask> {
    let done_by_id = existing
        .iter()
        .map(|task| (task.id.clone(), task.done))
        .collect::<HashMap<_, _>>();
    defaults
        .into_iter()
        .map(|mut task| {
            if let Some(done) = done_by_id.get(&task.id) {
                task.done = task.done || *done;
            }
            task
        })
        .collect()
}

fn validate_planner_date(date: &str) -> Result<&str, String> {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-'
        || bytes.iter().enumerate().any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return Err("Planner date must use YYYY-MM-DD".into());
    }
    Ok(date)
}

fn save_planner_store(root: &Path, store: &PlannerStore) -> Result<(), String> {
    fs::create_dir_all(roflow_dir(root)).map_err(|e| e.to_string())?;
    let mut text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(planner_store_path(root), text).map_err(|e| e.to_string())
}

fn load_planner_store(root: &Path, date: &str) -> Result<PlannerStore, String> {
    validate_planner_date(date)?;
    let path = planner_store_path(root);
    let mut store = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<PlannerStore>(&text).ok())
        .unwrap_or_default();

    let identity = project_manifest(root).project_id;
    let defaults = project_planner_defaults(root);

    if !store.project_id.is_empty() && store.project_id != identity {
        store = PlannerStore::default();
    } else if store.project_id.is_empty() && (!store.today.is_empty() || !store.roadmap.is_empty()) {
        let default_ids = defaults
            .today
            .iter()
            .chain(defaults.roadmap.iter())
            .map(|task| task.id.as_str())
            .collect::<BTreeSet<_>>();
        let legacy_matches = store
            .today
            .iter()
            .chain(store.roadmap.iter())
            .any(|task| default_ids.contains(task.id.as_str()));
        if !default_ids.is_empty() && !legacy_matches {
            store = PlannerStore::default();
        }
    }
    store.project_id = identity;

    store.roadmap = merge_planner_tasks(&store.roadmap, defaults.roadmap);

    if store.today_date != date {
        if !store.today_date.is_empty() && !store.today.is_empty() {
            store.today_history.insert(store.today_date.clone(), store.today.clone());
            if store.today_history.len() > 31 {
                if let Some(oldest) = store.today_history.keys().min().cloned() {
                    store.today_history.remove(&oldest);
                }
            }
        }
        store.today_date = date.to_string();
        store.today = defaults.today;
    } else {
        store.today = merge_planner_tasks(&store.today, defaults.today);
    }

    save_planner_store(root, &store)?;
    Ok(store)
}


fn load_task_store(root: &Path) -> TaskStore {
    let mut store = fs::read_to_string(task_store_path(root))
        .ok()
        .and_then(|text| serde_json::from_str::<TaskStore>(&text).ok())
        .unwrap_or_default();
    let identity = project_manifest(root).project_id;
    if !store.project_id.is_empty() && store.project_id != identity {
        store = TaskStore::default();
    }
    store.project_id = identity;
    store
}

fn save_task_store(root: &Path, store: &TaskStore) -> Result<(), String> {
    fs::create_dir_all(roflow_dir(root)).map_err(|e| e.to_string())?;
    let mut text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(task_store_path(root), text).map_err(|e| e.to_string())
}

fn unix_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|e| e.to_string())
}

fn record_task(
    root: &Path,
    kind: &str,
    title: &str,
    summary: &str,
    head_before: &str,
    head_after: &str,
    changed_files: Vec<String>,
    backup_version: &str,
    result: &str,
) -> Result<TaskEntry, String> {
    let mut store = load_task_store(root);
    let created_at = unix_now()?;
    let entry = TaskEntry {
        id: format!("{}-{}", created_at, store.tasks.len() + 1),
        created_at,
        kind: kind.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        head_before: head_before.to_string(),
        head_after: head_after.to_string(),
        changed_files,
        backup_version: backup_version.to_string(),
        result: result.to_string(),
    };
    store.tasks.push(entry.clone());
    if store.tasks.len() > 200 {
        let remove = store.tasks.len() - 200;
        store.tasks.drain(0..remove);
    }
    save_task_store(root, &store)?;
    Ok(entry)
}

fn clean_relative_path(path: &str) -> Result<&str, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path is empty".into());
    }
    let value = Path::new(trimmed);
    if value.is_absolute()
        || value.components().any(|component| {
            matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        })
    {
        return Err("Unsafe file path".into());
    }
    Ok(trimmed)
}

fn truncate_output(value: String, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value
    } else {
        let mut out: String = value.chars().take(max_chars).collect();
        out.push_str("\n\n[RoFlow truncated this output]");
        out
    }
}


fn load_backup_store(root: &Path) -> BackupStore {
    let mut store = fs::read_to_string(backup_store_path(root))
        .ok()
        .and_then(|text| serde_json::from_str::<BackupStore>(&text).ok())
        .unwrap_or_default();
    let identity = project_manifest(root).project_id;
    if !store.project_id.is_empty() && store.project_id != identity {
        store = BackupStore::default();
    }
    store.project_id = identity;
    store
}

fn save_backup_store(root: &Path, store: &BackupStore) -> Result<(), String> {
    fs::create_dir_all(roflow_dir(root)).map_err(|e| e.to_string())?;
    let mut text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(backup_store_path(root), text).map_err(|e| e.to_string())
}

fn backup_number(version: &str) -> u32 {
    version
        .strip_prefix("v0.")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
}

fn next_backup_version(root: &Path, store: &BackupStore) -> Result<String, String> {
    let mut max_number = store.backups.iter().map(|b| backup_number(&b.version)).max().unwrap_or(0);
    let refs = git(root, &["for-each-ref", "refs/roflow/backups/", "--format=%(refname:short)"])?;
    for line in refs.lines() {
        let label = line.rsplit('/').next().unwrap_or(line);
        max_number = max_number.max(backup_number(label));
    }
    Ok(format!("v0.{:03}", max_number + 1))
}

fn create_backup_internal(
    root: &Path,
    title: &str,
    summary: &str,
    automatic: bool,
) -> Result<BackupEntry, String> {
    let mut store = load_backup_store(root);
    let version = next_backup_version(root, &store)?;
    let source_head = git(root, &["rev-parse", "HEAD"])?;
    let subject = git(root, &["log", "-1", "--pretty=%s"]).unwrap_or_default();

    cleanup_roflow_temp_index(root)?;
    let (temp_index, temp_lock) = roflow_temp_index_paths(root)?;
    let temp_index_string = git_env_path(&temp_index);
    let index_env = [("GIT_INDEX_FILE", temp_index_string.as_str())];

    let snapshot_result = (|| -> Result<String, String> {
        git_env(root, &["read-tree", "HEAD"], &index_env)?;
        git_env(root, &["add", "-A"], &index_env)?;
        // Never put RoFlow metadata or recovery scratch files into snapshots.
        let _ = git_env(
            root,
            &["rm", "-r", "--cached", "--ignore-unmatch", ".roflow", ".recovery"],
            &index_env,
        );
        let tree = git_env(root, &["write-tree"], &index_env)?;

        let identity = [
            ("GIT_INDEX_FILE", temp_index_string.as_str()),
            ("GIT_AUTHOR_NAME", "RoFlow"),
            ("GIT_AUTHOR_EMAIL", "roflow@local"),
            ("GIT_COMMITTER_NAME", "RoFlow"),
            ("GIT_COMMITTER_EMAIL", "roflow@local"),
        ];
        git_env(
            root,
            &[
                "commit-tree",
                &tree,
                "-p",
                &source_head,
                "-m",
                &format!("RoFlow backup {version}"),
            ],
            &identity,
        )
    })();
    let _ = fs::remove_file(&temp_lock);
    let _ = fs::remove_file(&temp_index);
    let snapshot_sha = snapshot_result?;

    git(
        root,
        &[
            "update-ref",
            &format!("refs/roflow/backups/{version}"),
            &snapshot_sha,
        ],
    )?;

    let previous = store.backups.last();
    let diff_base = previous.map(|b| b.snapshot_sha.as_str()).unwrap_or(source_head.as_str());
    let changes = git(root, &["diff", "--name-status", diff_base, &snapshot_sha])
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(120)
        .map(str::to_string)
        .collect::<Vec<_>>();

    let commits = previous
        .filter(|p| p.source_head != source_head)
        .and_then(|p| git(root, &["log", "--format=%s", &format!("{}..{}", p.source_head, source_head)]).ok())
        .unwrap_or_else(|| if store.backups.is_empty() { subject.clone() } else { String::new() })
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(30)
        .map(str::to_string)
        .collect::<Vec<_>>();

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let entry = BackupEntry {
        version,
        snapshot_sha,
        source_head,
        created_at,
        title: title.trim().to_string(),
        summary: summary.trim().to_string(),
        changes,
        commits,
        automatic,
    };
    store.backups.push(entry.clone());
    save_backup_store(root, &store)?;
    Ok(entry)
}

fn ensure_initial_backup(root: &Path) -> Result<(), String> {
    if load_backup_store(root).backups.is_empty() {
        let subject = git(root, &["log", "-1", "--pretty=%s"]).unwrap_or_else(|_| "Initial project state".into());
        create_backup_internal(root, "Initial snapshot", &subject, true)?;
    }
    Ok(())
}

fn validate_project_root(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path).map_err(|e| format!("Project folder not found: {e}"))?;
    if !root.join(".git").exists() {
        return Err("Selected folder is not a Git working tree".into());
    }
    if !root.join("default.project.json").is_file() {
        return Err("default.project.json was not found in this project".into());
    }
    if git(&root, &["rev-parse", "--is-inside-work-tree"])? != "true" {
        return Err("Selected folder is not inside a Git working tree".into());
    }
    Ok(root)
}

fn current_root(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .project_root
        .lock()
        .map_err(|_| "Project state lock failed".to_string())?
        .clone()
        .ok_or_else(|| "Select a project folder first".to_string())
}

fn status_for(root: &Path) -> Result<ProjectStatus, String> {
    let meta = git(root, &["log", "-1", "--pretty=%H%x00%s"])?;
    let (head, subject) = meta
        .split_once('\0')
        .map(|(head, subject)| (head.to_string(), subject.to_string()))
        .unwrap_or_else(|| (meta.clone(), String::new()));

    let porcelain = git(root, &["status", "--porcelain=v1", "--branch"])?;
    let mut lines = porcelain.lines();
    let branch_line = lines.next().unwrap_or("");
    let branch = branch_line
        .strip_prefix("## ")
        .unwrap_or(branch_line)
        .split("...")
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();
    let changes: Vec<String> = lines
        .filter(|line| !line.trim().is_empty())
        .take(100)
        .map(str::to_string)
        .collect();

    let manifest = project_manifest(root);
    let model_exists = allowed_ui_model_paths(root)
        .iter()
        .any(|path| root.join(path).is_file());
    Ok(ProjectStatus {
        root: root.to_string_lossy().to_string(),
        project_id: manifest.project_id,
        display_name: manifest.display_name,
        branch,
        head,
        subject,
        dirty: !changes.is_empty(),
        changes,
        model_exists,
        planner_defaults_path: manifest.planner_defaults_path,
        build_file: manifest.build_file,
        runtime_probe_enabled: manifest.runtime_probe_enabled,
        release_gate_task_ids: manifest.release_gate_task_ids,
        ui_states: manifest.ui_states,
    })
}

fn parse_json_text(text: &str) -> Option<Value> {
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(path, text).map_err(|e| e.to_string())
}

fn backup_model(root: &Path, model_relative: &str) -> Result<String, String> {
    let model = root.join(model_relative);
    if !model.is_file() {
        return Ok(String::new());
    }
    let recovery = root.join(".recovery");
    fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let digest = format!("{:x}", Sha256::digest(model_relative.as_bytes()));
    let name = format!("ui-model-{}.before-roflow-sync.{stamp}.json", &digest[..10]);
    fs::copy(&model, recovery.join(&name)).map_err(|e| e.to_string())?;
    Ok(format!(".recovery/{name}"))
}

fn child_index(values: &[Value]) -> (Vec<String>, HashMap<String, Value>) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut order = Vec::with_capacity(values.len());
    let mut map = HashMap::new();

    for value in values {
        let base = if let Some(obj) = value.as_object() {
            format!(
                "{}\u{1f}{}",
                obj.get("ClassName").and_then(Value::as_str).unwrap_or(""),
                obj.get("Name").and_then(Value::as_str).unwrap_or("")
            )
        } else {
            format!("__raw__\u{1f}{}", serde_json::to_string(value).unwrap_or_default())
        };
        let index = counts.entry(base.clone()).or_insert(0);
        let key = format!("{base}\u{1f}{index}");
        *index += 1;
        order.push(key.clone());
        map.insert(key, value.clone());
    }
    (order, map)
}

fn is_required_runtime_ui_child(value: &Value) -> bool {
    matches!(
        value.get("Name").and_then(Value::as_str),
        Some(
            "ObjectiveCard"
                | "CurrencyHUD"
                | "MenuDock"
                | "RollHUD"
                | "VerticalRoulette"
                | "TutorialGuideBanner"
                | "Toast"
                | "ModalShade"
                | "MainPanel"
                | "RewardReveal"
                | "ActiveBoostsHUD"
                | "ActiveBoostTooltip"
                | "MinimizeButton"
                | "LuckBadge"
                | "ScrollLeft"
                | "ScrollRight"
                | "TraitFilterPanel"
                | "TraitFilterList"
                | "TraitChipTemplate"
                | "UnequipAllButton"
                | "EquippedBadge"
                | "InventoryHoverScale"
                | "BeeSummary"
                | "PassiveRowTemplate"
                | "AbilityDescription"
                | "UsedBadge"
                | "GhostBadge"
                | "CurrencyHelp"
                | "Dock_SeedSatchel"
                | "Dock_Garden"
                | "Dock_Hive"
                | "Dock_Index"
                | "Dock_Workshop"
                | "Dock_Quests"
                | "Dock_Settings"
                | "HiveKit"
                | "HiveShell"
                | "RoadList"
                | "RoadNodeTemplate"
                | "UpgradeButton"
                | "TraitBeeStrip"
                | "TraitBeeIconTemplate"
                | "EquipSynergyButton"
                | "TutorialSpotlight"
                | "TutorialCallout"
                | "TutorialScreenArrow"
                | "StateKits"
                | "ActionHitboxTemplate"
                | "OverlayHitboxTemplate"
                | "SearchBoxTemplate"
                | "EmptyStateTemplate"
                | "HoverScale"
                | "TutorialCompleteScale"
                | "SlotScale"
                | "WorkshopZoomScale"
                | "WorkshopTemplate"
                | "WorkshopBody"
                | "TreePanel"
                | "TreeCanvas"
                | "PanMap"
                | "NodeTooltip"
                | "WorkshopCurrencyBar"
                | "WorkshopPoints"
                | "WorkshopCoins"
                | "WorkshopPetalDust"
                | "WorkshopAncientNectar"
                | "WorldUIPrototypes"
                | "TutorialWorldBillboard"
                | "ActivityCheckpointBillboard"
                | "TutorialWorldLabelTemplate"
                | "ActivityCheckpointLabelTemplate"
        )
    )
}

fn merge_children(base: &[Value], local: &[Value], remote: &[Value]) -> Vec<Value> {
    let (_bo, bm) = child_index(base);
    let (lo, lm) = child_index(local);
    let (ro, rm) = child_index(remote);
    let mut out = Vec::new();
    let mut emitted = BTreeSet::new();

    for key in ro {
        emitted.insert(key.clone());
        let r = rm.get(&key).expect("remote key");
        match (bm.get(&key), lm.get(&key)) {
            (None, _) => out.push(r.clone()),
            (Some(b), None) => {
                if is_required_runtime_ui_child(r) || b != r {
                    out.push(r.clone());
                }
            }
            (Some(b), Some(l)) => out.push(merge_value(b, l, r)),
        }
    }

    for key in lo {
        if emitted.contains(&key) {
            continue;
        }
        if !bm.contains_key(&key) {
            if let Some(value) = lm.get(&key) {
                out.push(value.clone());
            }
        }
    }
    out
}

fn merge_value(base: &Value, local: &Value, remote: &Value) -> Value {
    let container_with_children = match (base.as_object(), local.as_object(), remote.as_object()) {
        (Some(b), Some(l), Some(r)) => {
            b.get("Children").and_then(Value::as_array).is_some()
                && l.get("Children").and_then(Value::as_array).is_some()
                && r.get("Children").and_then(Value::as_array).is_some()
        }
        _ => false,
    };
    if base == remote && !container_with_children {
        return local.clone();
    }
    if base == local {
        return remote.clone();
    }

    if let (Some(b), Some(l), Some(r)) = (base.as_object(), local.as_object(), remote.as_object()) {
        let mut out: Map<String, Value> = l.clone();
        let mut keys = BTreeSet::new();
        keys.extend(b.keys().cloned());
        keys.extend(l.keys().cloned());
        keys.extend(r.keys().cloned());

        for key in keys {
            let bv = b.get(&key);
            let lv = l.get(&key);
            let rv = r.get(&key);

            match (bv, lv, rv) {
                (Some(_), _, None) => {
                    out.remove(&key);
                }
                (None, _, Some(remote_value)) => {
                    out.insert(key, remote_value.clone());
                }
                (Some(base_value), None, Some(remote_value)) => {
                    if base_value == remote_value {
                        out.remove(&key);
                    } else {
                        out.insert(key, remote_value.clone());
                    }
                }
                (Some(base_value), Some(local_value), Some(remote_value)) => {
                    let merged = if key == "Children" {
                        match (
                            base_value.as_array(),
                            local_value.as_array(),
                            remote_value.as_array(),
                        ) {
                            (Some(ba), Some(la), Some(ra)) => {
                                Value::Array(merge_children(ba, la, ra))
                            }
                            _ => merge_value(base_value, local_value, remote_value),
                        }
                    } else {
                        merge_value(base_value, local_value, remote_value)
                    };
                    out.insert(key, merged);
                }
                _ => {}
            }
        }
        return Value::Object(out);
    }

    // Atomic Roblox values (UDim2, Color3, arrays) follow the explicitly
    // requested remote AI change when both sides edited the same value.
    remote.clone()
}

#[tauri::command]
fn set_project_root(path: String, state: State<AppState>) -> Result<ProjectStatus, String> {
    let root = validate_project_root(&path)?;

    let project_changed = {
        let guard = state
            .project_root
            .lock()
            .map_err(|_| "Project state lock failed".to_string())?;
        guard.as_ref().map(|current| current != &root).unwrap_or(true)
    };

    if project_changed {
        let mut rojo = state
            .rojo_child
            .lock()
            .map_err(|_| "Rojo state lock failed".to_string())?;
        if let Some(child) = rojo.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *rojo = None;
    }

    {
        let mut guard = state
            .project_root
            .lock()
            .map_err(|_| "Project state lock failed".to_string())?;
        *guard = Some(root.clone());
    }

    // Connecting stays lightweight. Backups are created only by explicit
    // checkpoints, restores, or successful AI Sync operations.
    status_for(&root)
}

#[tauri::command]
fn project_status(state: State<AppState>) -> Result<ProjectStatus, String> {
    status_for(&current_root(&state)?)
}

#[tauri::command]
fn read_ui_model(path: Option<String>, state: State<AppState>) -> Result<String, String> {
    let root = current_root(&state)?;
    let model_path = resolve_ui_model_path(&root, path)?;
    fs::read_to_string(root.join(&model_path))
        .map_err(|e| format!("Failed to read {model_path}: {e}"))
}

#[tauri::command]
fn write_ui_model(contents: String, path: Option<String>, state: State<AppState>) -> Result<(), String> {
    let root = current_root(&state)?;
    let model_path = resolve_ui_model_path(&root, path)?;
    serde_json::from_str::<Value>(&contents)
        .map_err(|e| format!("Refusing to write invalid JSON: {e}"))?;
    fs::write(root.join(&model_path), contents)
        .map_err(|e| format!("Failed to write {model_path}: {e}"))
}

#[tauri::command]
fn git_diff_stat(state: State<AppState>) -> Result<String, String> {
    git(&current_root(&state)?, &["diff", "--stat"])
}

#[tauri::command]
fn safe_ai_sync(editor_model: Option<Value>, state: State<AppState>) -> Result<SyncResult, String> {
    let root = current_root(&state)?;

    cleanup_roflow_temp_index(&root)?;

    if let Some(lock) = git_index_lock(&root)? {
        return Err(format!(
            "Git index is locked at {lock}. Close any Git process using this project, then retry. RoFlow will not delete an index lock automatically."
        ));
    }

    let mut recovered_conflicts = Vec::new();
    let mut conflict_recoveries = Vec::new();
    let mut preserved_stashes = Vec::new();

    let existing_conflicts = unmerged_paths(&root)?;
    if !existing_conflicts.is_empty() {
        let (_, stash_sha) = find_roflow_sync_stash(&root)?.ok_or_else(|| {
            format!(
                "Repository already has unresolved Git conflicts: {}. They are not tied to a recoverable RoFlow AI SYNC stash, so RoFlow will not modify them.",
                existing_conflicts.join(", ")
            )
        })?;
        let recovery = recover_roflow_conflicts(&root, &stash_sha, &existing_conflicts)?;
        recovered_conflicts.extend(existing_conflicts);
        conflict_recoveries.push(recovery);
        preserved_stashes.push(stash_sha);
    }

    let before = status_for(&root)?;
    let old_head = before.head.clone();
    let primary_model = primary_ui_model_path(&root)?;
    let model_path = root.join(&primary_model);
    let base_spec = format!("HEAD:{primary_model}");
    let base_text = git(&root, &["show", &base_spec])?;
    let base_model = parse_json_text(&base_text)
        .ok_or_else(|| format!("HEAD {primary_model} is invalid"))?;

    let model_dirty = !git(
        &root,
        &["status", "--porcelain", "--", primary_model.as_str()],
    )?
    .trim()
    .is_empty();
    let disk_text = fs::read_to_string(&model_path).ok();
    let disk_model = disk_text.as_deref().and_then(parse_json_text);
    let local_model = if model_dirty {
        editor_model.or(disk_model)
    } else {
        None
    };

    let mut recovery_backup = String::new();
    if model_dirty {
        recovery_backup = backup_model(&root, &primary_model)?;
        if local_model.is_none() {
            return Err(format!(
                "{primary_model} is invalid. Raw file preserved at {}",
                recovery_backup
            ));
        }
        git(
            &root,
            &[
                "restore",
                "--staged",
                "--worktree",
                "--",
                primary_model.as_str(),
            ],
        )?;
    }

    let mut stashed = false;
    let mut restored = false;
    let mut active_stash_sha = String::new();
    let after_model = status_for(&root)?;
    if after_model.dirty {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
        let label = format!("RoFlow AI SYNC {stamp}");
        git(&root, &["stash", "push", "-u", "-m", &label])?;
        active_stash_sha = git(&root, &["rev-parse", "stash@{0}"])?;
        stashed = true;
    }

    if let Err(pull_error) = git(&root, &["pull", "--ff-only"]) {
        let mut recovery_note = String::new();
        if stashed {
            match git(&root, &["stash", "apply", "stash@{0}"]) {
                Ok(_) => {
                    restored = true;
                    let _ = git(&root, &["stash", "drop", "stash@{0}"]);
                }
                Err(restore_error) => {
                    let conflicts = unmerged_paths(&root)?;
                    if conflicts.is_empty() {
                        recovery_note = format!(
                            " Local changes remain safely in stash {} because restore failed: {}",
                            active_stash_sha, restore_error
                        );
                    } else {
                        match recover_roflow_conflicts(&root, &active_stash_sha, &conflicts) {
                            Ok(recovery) => {
                                restored = true;
                                recovery_note = format!(
                                    " Conflicting local copies were preserved at {} and stash {} was kept.",
                                    recovery, active_stash_sha
                                );
                            }
                            Err(recovery_error) => {
                                return Err(format!(
                                    "git pull --ff-only failed: {pull_error}. Local restore also conflicted ({restore_error}) and recovery failed: {recovery_error}. Stash {active_stash_sha} was kept."
                                ));
                            }
                        }
                    }
                }
            }
        }
        if let Some(local) = &local_model {
            let _ = write_json(&model_path, local);
        }
        return Err(format!("git pull --ff-only failed: {pull_error}.{recovery_note}"));
    }

    if stashed {
        match git(&root, &["stash", "apply", "stash@{0}"]) {
            Ok(_) => {
                restored = true;
                git(&root, &["stash", "drop", "stash@{0}"])?;
            }
            Err(error) => {
                let conflicts = unmerged_paths(&root)?;
                if conflicts.is_empty() {
                    git(&root, &["reset", "--hard", "HEAD"])?;
                    let _ = git(&root, &["clean", "-fd", "-e", ".roflow", "-e", ".recovery"]);
                    preserved_stashes.push(active_stash_sha.clone());
                    return Err(format!(
                        "Git updated, but local changes could not be restored cleanly. Partial stash changes were rolled back to HEAD and stash {} was kept intact. {}",
                        active_stash_sha, error
                    ));
                }
                let recovery = recover_roflow_conflicts(&root, &active_stash_sha, &conflicts)?;
                recovered_conflicts.extend(conflicts);
                conflict_recoveries.push(recovery);
                preserved_stashes.push(active_stash_sha.clone());
                restored = true;
            }
        }
    }

    let remote_text = fs::read_to_string(&model_path).map_err(|e| e.to_string())?;
    let remote_model = parse_json_text(&remote_text)
        .ok_or_else(|| format!("Pulled {primary_model} is invalid"))?;
    let mut model_merged = false;

    if let Some(local) = local_model {
        let merged = merge_value(&base_model, &local, &remote_model);
        write_json(&model_path, &merged)?;
        model_merged = true;
    }

    recovered_conflicts.sort();
    recovered_conflicts.dedup();
    conflict_recoveries.sort();
    conflict_recoveries.dedup();
    preserved_stashes.sort();
    preserved_stashes.dedup();

    let final_status = status_for(&root)?;
    let backup = create_backup_internal(
        &root,
        "AI Sync",
        &final_status.subject,
        true,
    ).ok();
    let backup_version = backup.map(|entry| entry.version).unwrap_or_default();
    let changed_files = git(&root, &["diff", "--name-only", &format!("{}..{}", old_head, final_status.head)])
        .unwrap_or_default()
        .lines()
        .chain(final_status.changes.iter().filter_map(|line| line.get(3..)))
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(80)
        .collect::<Vec<_>>();
    let summary = if !recovered_conflicts.is_empty() {
        format!(
            "Pulled latest changes and recovered an interrupted RoFlow stash apply. {} conflict path(s) were reset to HEAD; local copies and the stash were preserved.",
            recovered_conflicts.len()
        )
    } else if old_head != final_status.head {
        "Pulled and applied the latest repository changes.".to_string()
    } else {
        "Repository was already current; local work was preserved.".to_string()
    };
    let _ = record_task(
        &root,
        "ai-sync",
        "AI Sync",
        &summary,
        &old_head,
        &final_status.head,
        changed_files,
        &backup_version,
        if recovered_conflicts.is_empty() { "success" } else { "success-with-recovery" },
    );
    Ok(SyncResult {
        changed: old_head != final_status.head,
        head: final_status.head,
        subject: final_status.subject,
        dirty: final_status.dirty,
        stashed,
        restored,
        model_merged,
        recovery_backup,
        backup_version,
        recovered_conflicts,
        conflict_recoveries,
        preserved_stashes,
    })
}

#[tauri::command]
fn list_backups(state: State<AppState>) -> Result<Vec<BackupEntry>, String> {
    let root = current_root(&state)?;
    let mut backups = load_backup_store(&root).backups;
    backups.sort_by_key(|entry| std::cmp::Reverse(backup_number(&entry.version)));
    Ok(backups)
}

#[tauri::command]
fn create_backup(
    title: Option<String>,
    summary: Option<String>,
    state: State<AppState>,
) -> Result<BackupEntry, String> {
    let root = current_root(&state)?;
    create_backup_internal(
        &root,
        title.as_deref().unwrap_or("Manual checkpoint"),
        summary.as_deref().unwrap_or("Created manually in RoFlow"),
        false,
    )
}

#[tauri::command]
fn restore_backup(version: String, state: State<AppState>) -> Result<RestoreResult, String> {
    let root = current_root(&state)?;
    let store = load_backup_store(&root);
    let target = store
        .backups
        .iter()
        .find(|entry| entry.version == version)
        .cloned()
        .ok_or_else(|| format!("Backup {version} was not found"))?;

    let safety = create_backup_internal(
        &root,
        "Safety snapshot",
        &format!("Automatic backup before restoring {}", target.version),
        true,
    )?;

    git(
        &root,
        &[
            "restore",
            "--source",
            &target.snapshot_sha,
            "--staged",
            "--worktree",
            "--",
            ".",
        ],
    )?;
    // Exact restore for normal files while explicitly preserving RoFlow metadata
    // and recovery material.
    let _ = git(&root, &["clean", "-fd", "-e", ".roflow/", "-e", ".recovery/"]);

    Ok(RestoreResult {
        restored_version: target.version,
        safety_version: safety.version,
        status: status_for(&root)?,
    })
}

fn parse_git_changes(root: &Path) -> Result<Vec<GitChange>, String> {
    let porcelain = git(root, &["status", "--porcelain=v1"])?;
    Ok(porcelain
        .lines()
        .filter(|line| line.len() >= 3)
        .take(200)
        .map(|line| {
            let code = line.get(0..2).unwrap_or("??").to_string();
            let raw_path = line.get(3..).unwrap_or("").trim();
            let path = raw_path
                .rsplit_once(" -> ")
                .map(|(_, new_path)| new_path)
                .unwrap_or(raw_path)
                .trim_matches('"')
                .to_string();
            let first = code.chars().next().unwrap_or(' ');
            GitChange {
                staged: first != ' ' && first != '?',
                untracked: code == "??",
                status: code,
                path,
            }
        })
        .collect())
}

fn find_rojo(root: &Path) -> Option<PathBuf> {
    let local = root.join("rojo.exe");
    if local.is_file() {
        return Some(local);
    }

    if let Ok(profile) = env::var("USERPROFILE") {
        let desktop = PathBuf::from(profile).join("Desktop").join("Rojo").join("rojo.exe");
        if desktop.is_file() {
            return Some(desktop);
        }
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("where");
        cmd.arg("rojo");
        cmd
    } else {
        let mut cmd = Command::new("which");
        cmd.arg("rojo");
        cmd
    };
    hide_console(&mut command);
    let output = command.output().ok()?;
    if output.status.success() {
        let first = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(str::trim)
            .filter(|line| !line.is_empty())?
            .to_string();
        return Some(PathBuf::from(first));
    }

    None
}

fn roblox_logs_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("Roblox").join("logs"))
            .map_err(|_| "LOCALAPPDATA is unavailable".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return env::var("HOME")
            .map(PathBuf::from)
            .map(|path| path.join("Library").join("Logs").join("Roblox"))
            .map_err(|_| "HOME is unavailable".to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Roblox Studio log discovery is unsupported on this platform".into())
    }
}

fn recent_studio_logs(limit: usize) -> Result<Vec<(PathBuf, u64)>, String> {
    let dir = roblox_logs_dir()?;
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Roblox log directory is unavailable ({}): {e}", dir.display()))?;
    let mut logs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
        let lower = name.to_ascii_lowercase();
        if !lower.contains("robloxstudio") || !lower.ends_with(".log") { continue; }
        let modified = entry.metadata().and_then(|meta| meta.modified()).unwrap_or(UNIX_EPOCH);
        let seconds = modified.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        logs.push((path, seconds));
    }
    logs.sort_by_key(|(_, modified)| *modified);
    if logs.len()>limit {
        let drop_count=logs.len()-limit;
        logs.drain(0..drop_count);
    }
    if logs.is_empty() { return Err("No Roblox Studio log found yet".into()); }
    Ok(logs)
}

fn read_file_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity((len-start) as usize);
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if start > 0 {
        if let Some(index) = text.find('\n') { text.drain(..=index); }
    }
    Ok(text)
}

fn tagged_value(line: &str, key: &str) -> Option<String> {
    let token = format!("{key}=");
    let start = line.find(&token)? + token.len();
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let value = rest[..end].trim_matches(|c: char| c==',' || c==';').trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn checkpoint_minute(line: &str) -> Option<u32> {
    let marker="CHECKPOINT_";
    let start=line.find(marker)?+marker.len();
    let rest=&line[start..];
    let end=rest.find('m')?;
    rest[..end].parse::<u32>().ok()
}


#[tauri::command]
fn runtime_probe_report(state: State<AppState>) -> Result<RuntimeProbeReport, String> {
    let root = current_root(&state)?;
    if !project_manifest(&root).runtime_probe_enabled {
        return Ok(RuntimeProbeReport {
            available: false,
            path: String::new(),
            modified_at: 0,
            milestones: Vec::new(),
            evidence: Vec::new(),
            latest_server_checkpoint: String::new(),
            latest_client_checkpoint: String::new(),
            latest_persistence_join: String::new(),
            latest_persistence_leave: String::new(),
            persistence_verdict: "DISABLED".into(),
            checkpoint_minutes: Vec::new(),
            logs_scanned: 0,
            lines: Vec::new(),
        });
    }
    let logs = recent_studio_logs(8)?;
    let latest = logs.last().cloned().ok_or_else(|| "No Roblox Studio log found yet".to_string())?;
    let mut milestones = BTreeSet::new();
    let mut evidence = BTreeSet::new();
    let mut server_checkpoints = BTreeSet::new();
    let mut client_checkpoints = BTreeSet::new();
    let mut latest_server_checkpoint = String::new();
    let mut latest_client_checkpoint = String::new();
    let mut latest_persistence_join = String::new();
    let mut latest_persistence_leave = String::new();
    let mut persistence_verdict = "NO_PAIR".to_string();
    let mut pending_leave_digest: Option<String> = None;
    let mut lines = Vec::new();

    for (path, _) in &logs {
        let text = read_file_tail(path, 1_000_000)?;
        for raw in text.lines() {
            if !(raw.contains("[RuntimeProbe]") || raw.contains("[PersistenceProbe]")) { continue; }
            let line = raw.trim().to_string();

            if line.contains("[RuntimeProbe][Server] MILESTONE") {
                if let Some(name) = tagged_value(&line, "name") { milestones.insert(name); }
            }
            if line.contains("[RuntimeProbe][Server] EVIDENCE") && !line.contains("EVIDENCE_SUMMARY") {
                if let Some(name) = tagged_value(&line, "name") { evidence.insert(name); }
            }
            if line.contains("[RuntimeProbe][Server] CHECKPOINT_") {
                if let Some(minute) = checkpoint_minute(&line) { server_checkpoints.insert(minute); }
                latest_server_checkpoint = line.clone();
            }
            if line.contains("[RuntimeProbe][Client] CHECKPOINT_") {
                if let Some(minute) = checkpoint_minute(&line) { client_checkpoints.insert(minute); }
                latest_client_checkpoint = line.clone();
            }
            if line.contains("[PersistenceProbe] LEAVE") {
                latest_persistence_leave = line.clone();
                pending_leave_digest = tagged_value(&line, "digest");
                persistence_verdict = "WAITING_REJOIN".into();
            }
            if line.contains("[PersistenceProbe] JOIN") {
                latest_persistence_join = line.clone();
                if let Some(previous) = pending_leave_digest.take() {
                    if let Some(current) = tagged_value(&line, "digest") {
                        persistence_verdict = if current == previous { "MATCH" } else { "MISMATCH" }.into();
                    }
                }
            }

            lines.push(line);
            if lines.len() > 200 { lines.remove(0); }
        }
    }

    let checkpoint_minutes = server_checkpoints
        .intersection(&client_checkpoints)
        .copied()
        .collect::<Vec<_>>();

    Ok(RuntimeProbeReport {
        available: !lines.is_empty(),
        path: latest.0.to_string_lossy().to_string(),
        modified_at: latest.1,
        milestones: milestones.into_iter().collect(),
        evidence: evidence.into_iter().collect(),
        latest_server_checkpoint,
        latest_client_checkpoint,
        latest_persistence_join,
        latest_persistence_leave,
        persistence_verdict,
        checkpoint_minutes,
        logs_scanned: logs.len(),
        lines,
    })
}

fn rojo_version(path: &Path) -> String {
    let mut command = Command::new(path);
    command.arg("--version");
    hide_console(&mut command);
    command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn rojo_running(state: &AppState) -> Result<bool, String> {
    let mut guard = state.rojo_child.lock().map_err(|_| "Rojo state lock failed".to_string())?;
    let exited = if let Some(child) = guard.as_mut() {
        child.try_wait().map_err(|e| e.to_string())?.is_some()
    } else {
        false
    };
    if exited {
        *guard = None;
    }
    Ok(guard.is_some())
}

fn rojo_status_for(root: &Path, state: &AppState) -> Result<RojoStatus, String> {
    let executable = find_rojo(root);
    let running = rojo_running(state)?;
    let build_file_name = project_manifest(root).build_file;
    Ok(RojoStatus {
        available: executable.is_some(),
        running,
        version: executable.as_deref().map(rojo_version).unwrap_or_default(),
        path: executable
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        project_file: root.join("default.project.json").is_file(),
        build_file: root.join(&build_file_name).is_file(),
        build_file_name,
    })
}

#[tauri::command]
fn planner_state(date: String, state: State<AppState>) -> Result<PlannerStore, String> {
    let root = current_root(&state)?;
    load_planner_store(&root, &date)
}

#[tauri::command]
fn planner_set_done(task_id: String, done: bool, state: State<AppState>) -> Result<PlannerStore, String> {
    let root = current_root(&state)?;
    let path = planner_store_path(&root);
    let mut store = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<PlannerStore>(&text).ok())
        .ok_or("Planner has not been initialized yet")?;

    let identity = project_manifest(&root).project_id;
    if store.project_id != identity {
        return Err("Planner state belongs to another project. Reload the Planner.".into());
    }

    let mut found = false;
    for task in store.today.iter_mut().chain(store.roadmap.iter_mut()) {
        if task.id == task_id {
            task.done = done;
            found = true;
            break;
        }
    }
    if !found {
        return Err("Planner task was not found".into());
    }
    save_planner_store(&root, &store)?;
    Ok(store)
}

#[tauri::command]
fn git_changes(state: State<AppState>) -> Result<Vec<GitChange>, String> {
    parse_git_changes(&current_root(&state)?)
}

#[tauri::command]
fn git_file_diff(path: String, state: State<AppState>) -> Result<String, String> {
    let root = current_root(&state)?;
    let safe = clean_relative_path(&path)?;
    let diff = git(
        &root,
        &["diff", "--no-ext-diff", "--unified=3", "HEAD", "--", safe],
    )?;
    if !diff.trim().is_empty() {
        return Ok(truncate_output(diff, 220_000));
    }

    let status = git(&root, &["status", "--porcelain=v1", "--", safe])?;
    if status.starts_with("??") {
        let candidate = root.join(safe);
        let metadata = fs::metadata(&candidate).map_err(|e| e.to_string())?;
        if metadata.len() > 220_000 {
            return Ok(format!(
                "Untracked file is {} bytes. RoFlow does not inline files larger than 220 KB.",
                metadata.len()
            ));
        }
        return match fs::read_to_string(&candidate) {
            Ok(text) => Ok(format!(
                "--- /dev/null\n+++ b/{safe}\n{}",
                text.lines()
                    .map(|line| format!("+{line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )),
            Err(_) => Ok("Untracked binary or non-UTF8 file. Preview is unavailable.".into()),
        };
    }

    Ok("No textual diff for this path.".into())
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> Result<Vec<TaskEntry>, String> {
    let root = current_root(&state)?;
    let mut tasks = load_task_store(&root).tasks;
    tasks.sort_by_key(|task| std::cmp::Reverse(task.created_at));
    tasks.truncate(80);
    Ok(tasks)
}

#[tauri::command]
fn git_commit(message: String, state: State<AppState>) -> Result<CommitResult, String> {
    let root = current_root(&state)?;
    let message = message.trim();
    if message.len() < 3 || message.len() > 180 {
        return Err("Commit message must contain 3-180 characters".into());
    }

    let before = status_for(&root)?;
    if !before.dirty {
        return Err("Working tree is clean".into());
    }

    let safety = create_backup_internal(
        &root,
        "Before commit",
        message,
        true,
    )?;

    git(&root, &["add", "-A"])?;
    let output = git(&root, &["commit", "-m", message])?;
    let after = status_for(&root)?;
    let changed_files = before
        .changes
        .iter()
        .filter_map(|line| line.get(3..))
        .map(str::to_string)
        .take(100)
        .collect::<Vec<_>>();
    let _ = record_task(
        &root,
        "commit",
        message,
        &truncate_output(output, 3_000),
        &before.head,
        &after.head,
        changed_files,
        &safety.version,
        "success",
    );

    Ok(CommitResult {
        head: after.head.clone(),
        subject: after.subject.clone(),
        backup_version: safety.version,
        status: after,
    })
}

#[tauri::command]
fn health_check(state: State<AppState>) -> Result<HealthReport, String> {
    let root = current_root(&state)?;
    let mut checks = Vec::new();

    let git_ok = git(&root, &["rev-parse", "--is-inside-work-tree"])
        .map(|value| value == "true")
        .unwrap_or(false);
    checks.push(HealthItem {
        name: "Git working tree".into(),
        ok: git_ok,
        detail: if git_ok { "Repository is accessible".into() } else { "Git working tree check failed".into() },
    });

    let manifest = project_manifest(&root);
    let model_paths = allowed_ui_model_paths(&root);
    let model_exists = !model_paths.is_empty()
        && model_paths.iter().all(|path| root.join(path).is_file());
    checks.push(HealthItem {
        name: "Authored UI models".into(),
        ok: model_exists,
        detail: if model_paths.is_empty() {
            "No UI model is configured. Add uiStates to roflow.project.json.".into()
        } else if model_exists {
            format!("{} configured model(s) are present", model_paths.len())
        } else {
            let missing = model_paths
                .iter()
                .filter(|path| !root.join(path).is_file())
                .cloned()
                .collect::<Vec<_>>();
            format!("Missing: {}", missing.join(", "))
        },
    });

    let mut invalid_models = Vec::new();
    let mut parsed_models = HashMap::<String, Value>::new();
    for path in &model_paths {
        match fs::read_to_string(root.join(path))
            .ok()
            .and_then(|text| parse_json_text(&text))
        {
            Some(value) => {
                parsed_models.insert(path.clone(), value);
            }
            None => invalid_models.push(path.clone()),
        }
    }
    checks.push(HealthItem {
        name: "UI model JSON".into(),
        ok: !model_paths.is_empty() && invalid_models.is_empty(),
        detail: if invalid_models.is_empty() && !model_paths.is_empty() {
            "Configured UI model JSON is valid".into()
        } else if invalid_models.is_empty() {
            "No configured UI model to validate".into()
        } else {
            format!("Invalid or unreadable: {}", invalid_models.join(", "))
        },
    });

    let missing_roots = manifest
        .ui_states
        .iter()
        .filter_map(|state| match parsed_models.get(&state.model_path) {
            Some(model) if json_tree_has_name(model, &state.root) => None,
            _ => Some(format!("{} → {}", state.id, state.root)),
        })
        .collect::<Vec<_>>();
    checks.push(HealthItem {
        name: "UI state roots".into(),
        ok: manifest.ui_states.is_empty() || missing_roots.is_empty(),
        detail: if manifest.ui_states.is_empty() {
            "No project UI states declared".into()
        } else if missing_roots.is_empty() {
            format!("{} UI state root(s) resolved", manifest.ui_states.len())
        } else {
            format!("Missing authored roots: {}", missing_roots.join(", "))
        },
    });

    let planner_ok = if manifest.planner_defaults_path.is_empty() {
        true
    } else {
        fs::read_to_string(root.join(&manifest.planner_defaults_path))
            .ok()
            .and_then(|text| serde_json::from_str::<PlannerDefaults>(&text).ok())
            .map(|defaults| defaults.schema_version == 1)
            .unwrap_or(false)
    };
    checks.push(HealthItem {
        name: "Planner defaults".into(),
        ok: planner_ok,
        detail: if manifest.planner_defaults_path.is_empty() {
            "Project uses an empty planner by default".into()
        } else if planner_ok {
            manifest.planner_defaults_path.clone()
        } else {
            format!(
                "{} is missing or invalid",
                manifest.planner_defaults_path
            )
        },
    });

    let project_path = root.join("default.project.json");
    let project_valid = fs::read_to_string(&project_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .is_some();
    checks.push(HealthItem {
        name: "Rojo project".into(),
        ok: project_valid,
        detail: if project_valid { "default.project.json is valid".into() } else { "default.project.json is missing or invalid".into() },
    });

    let unmerged = git(&root, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
    checks.push(HealthItem {
        name: "Merge conflicts".into(),
        ok: unmerged.trim().is_empty(),
        detail: if unmerged.trim().is_empty() { "No unresolved Git conflicts".into() } else { truncate_output(unmerged, 2_000) },
    });

    let index_lock = git_dir_path(&root).map(|p| p.join("index.lock")).unwrap_or_else(|_| root.join(".git").join("index.lock"));
    let roflow_lock = git_dir_path(&root).map(|p| p.join("roflow-backup.index.lock")).unwrap_or_else(|_| root.join(".git").join("roflow-backup.index.lock"));
    let lock_ok = !index_lock.exists() && !roflow_lock.exists();
    checks.push(HealthItem {
        name: "Git lock".into(),
        ok: lock_ok,
        detail: if index_lock.exists() {
            ".git/index.lock exists".into()
        } else if roflow_lock.exists() {
            ".git/roflow-backup.index.lock exists".into()
        } else {
            "No stale Git index lock".into()
        },
    });

    let src_ok = root.join("src").is_dir();
    checks.push(HealthItem {
        name: "Rojo source tree".into(),
        ok: src_ok,
        detail: if src_ok { "src/ is available".into() } else { "src/ directory is missing".into() },
    });

    let rojo = find_rojo(&root);
    checks.push(HealthItem {
        name: "Rojo executable".into(),
        ok: rojo.is_some(),
        detail: rojo
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "Rojo was not found in project, Desktop\\Rojo, or PATH".into()),
    });

    let passed = checks.iter().filter(|check| check.ok).count();
    Ok(HealthReport {
        passed,
        total: checks.len(),
        checks,
    })
}

#[tauri::command]
fn rojo_status(state: State<AppState>) -> Result<RojoStatus, String> {
    let root = current_root(&state)?;
    rojo_status_for(&root, &state)
}

#[tauri::command]
fn rojo_start(state: State<AppState>) -> Result<RojoStatus, String> {
    let root = current_root(&state)?;
    if rojo_running(&state)? {
        return rojo_status_for(&root, &state);
    }
    let executable = find_rojo(&root).ok_or("Rojo executable was not found")?;
    if !root.join("default.project.json").is_file() {
        return Err("default.project.json is missing".into());
    }

    let mut command = Command::new(&executable);
    command
        .arg("serve")
        .arg("default.project.json")
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let child = command.spawn().map_err(|e| format!("Failed to start Rojo: {e}"))?;
    *state.rojo_child.lock().map_err(|_| "Rojo state lock failed".to_string())? = Some(child);
    rojo_status_for(&root, &state)
}

#[tauri::command]
fn rojo_stop(state: State<AppState>) -> Result<RojoStatus, String> {
    let root = current_root(&state)?;
    {
        let mut guard = state.rojo_child.lock().map_err(|_| "Rojo state lock failed".to_string())?;
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
    rojo_status_for(&root, &state)
}

#[tauri::command]
async fn rojo_build(state: State<'_, AppState>) -> Result<ActionResult, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let executable = find_rojo(&root).ok_or("Rojo executable was not found")?;
        let build_file = project_manifest(&root).build_file;
        let output_path = root.join(&build_file);
        let mut command = Command::new(&executable);
        command
            .arg("build")
            .arg("default.project.json")
            .arg("-o")
            .arg(&output_path)
            .current_dir(&root);
        hide_console(&mut command);
        let output = command.output().map_err(|e| format!("Rojo build failed to start: {e}"))?;
        let mut text = String::from_utf8_lossy(&output.stdout).to_string();
        if !output.stderr.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&String::from_utf8_lossy(&output.stderr));
        }
        Ok(ActionResult {
            success: output.status.success(),
            output: truncate_output(text, 40_000),
            path: output_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_roblox_project(state: State<AppState>) -> Result<(), String> {
    let root = current_root(&state)?;
    let build_file = project_manifest(&root).build_file;
    let project = root.join(&build_file);
    if !project.is_file() {
        return Err(format!("{build_file} does not exist yet. Build the project first."));
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        command.arg(&project);
        hide_console(&mut command);
        command.spawn().map_err(|e| format!("Failed to open Roblox project: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Open Studio is currently implemented for Windows only".into())
    }
}

#[tauri::command]
async fn open_backups_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("backups") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "backups",
        WebviewUrl::App("backups.html".into()),
    )
    .title("RoFlow · Backups")
    .inner_size(960.0, 720.0)
    .min_inner_size(760.0, 560.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn roflow_update_status(state: State<AppState>) -> Result<UpdateStatus, String> {
    let root = current_root(&state)?;
    let manifest = fetch_update_manifest(&root)?;
    let current_build = roflow_build_sha().to_string();
    Ok(UpdateStatus {
        available: current_build != manifest.source_sha,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        current_build,
        latest_version: manifest.version.clone(),
        latest_build: manifest.source_sha.clone(),
        installer_version: manifest.installer_version.clone(),
        published_at: manifest.published_at.clone(),
    })
}

#[tauri::command]
fn roflow_install_update(app: AppHandle, state: State<AppState>) -> Result<UpdateInstallResult, String> {
    let root = current_root(&state)?;
    let manifest = fetch_update_manifest(&root)?;
    if roflow_build_sha() == manifest.source_sha {
        return Err("RoFlow is already current".into());
    }

    let spec = format!("{UPDATE_REMOTE_REF}:{}", manifest.filename);
    let bytes = git_blob(&root, &spec)?;
    let digest = sha256_hex(&bytes);
    if !digest.eq_ignore_ascii_case(&manifest.sha256) {
        return Err("RoFlow update installer checksum mismatch".into());
    }

    let update_dir = env::temp_dir().join("roflow-updates");
    fs::create_dir_all(&update_dir).map_err(|e| format!("Failed to create update folder: {e}"))?;
    let short = manifest.source_sha.get(..8).unwrap_or("latest");
    let installer = update_dir.join(format!("RoFlow-{short}-setup.exe"));
    fs::write(&installer, &bytes).map_err(|e| format!("Failed to stage RoFlow update: {e}"))?;
    let current_exe = env::current_exe().map_err(|e| format!("Failed to locate RoFlow executable: {e}"))?;
    let script_path = update_dir.join(format!("install-{short}.ps1"));

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "$ErrorActionPreference='Stop'\nStart-Sleep -Milliseconds 900\n$installer='{}'\n$app='{}'\n$p=Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru\nif($p.ExitCode -eq 0){{Start-Sleep -Milliseconds 500;Start-Process -FilePath $app}}\n",
            ps_literal(&installer),
            ps_literal(&current_exe),
        );
        fs::write(&script_path, script).map_err(|e| format!("Failed to create update launcher: {e}"))?;
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        command.arg(&script_path);
        hide_console(&mut command);
        command
            .spawn()
            .map_err(|e| format!("Failed to launch RoFlow updater: {e}"))?;

        let result = UpdateInstallResult {
            source_sha: manifest.source_sha,
            installer_path: installer.to_string_lossy().to_string(),
        };
        app.exit(0);
        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = script_path;
        Err("RoFlow auto-update is currently supported on Windows only".into())
    }
}

#[tauri::command]
fn ui_studio_document() -> Result<String, String> {
    Err("Standalone RoFlow uses the bundled UI Studio".into())
}

#[tauri::command]
async fn roblox_thumbnail_url(asset_id: String) -> Result<String, String> {
    if asset_id.is_empty() || asset_id.len() > 20 || !asset_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid Roblox asset id".into());
    }

    let client = reqwest::Client::new();
    let response = client
        .get("https://thumbnails.roblox.com/v1/assets")
        .query(&[
            ("assetIds", asset_id.as_str()),
            ("returnPolicy", "PlaceHolder"),
            ("size", "420x420"),
            ("format", "Png"),
            ("isCircular", "false"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("imageUrl"))
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| "Roblox thumbnail is not ready".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_project_root,
            project_status,
            read_ui_model,
            write_ui_model,
            git_diff_stat,
            planner_state,
            planner_set_done,
            git_changes,
            git_file_diff,
            git_commit,
            health_check,
            list_tasks,
            rojo_status,
            runtime_probe_report,
            rojo_start,
            rojo_stop,
            rojo_build,
            open_roblox_project,
            safe_ai_sync,
            list_backups,
            create_backup,
            restore_backup,
            open_backups_window,
            roflow_update_status,
            roflow_install_update,
            ui_studio_document,
            roblox_thumbnail_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running RoFlow");
}

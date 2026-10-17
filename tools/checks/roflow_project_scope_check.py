#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
rust=(ROOT/"src-tauri/src/lib.rs").read_text(encoding="utf-8")
web=(ROOT/"web/app.js").read_text(encoding="utf-8")
studio=(ROOT/"ui-studio/app.js").read_text(encoding="utf-8")

def need(src, token, label):
    if token not in src:
        raise AssertionError(f"{label}: missing {token!r}")

need(rust,'const PROJECT_MANIFEST_PATH: &str = "roflow.project.json";',"project manifest")
need(rust,'const UPDATE_SOURCE_URL: &str = "https://github.com/itsrekito-stack/RoFlow.git";',"standalone updater source")
need(rust,'project_id: String',"project identity")
need(rust,'ui_states: Vec<UiStateManifest>',"manifest-driven UI states")
need(rust,'today: Vec::new()',"generic empty planner fallback")
need(rust,'build_file_name: String',"dynamic build output")
need(rust,'fn allowed_ui_model_paths(root: &Path)',"manifest-driven UI model allowlist")
need(rust,'fn resolve_ui_model_path(root: &Path, requested: Option<String>)',"manifest-driven model IO")
need(rust,'if let Ok(configured_model) = primary_ui_model_path(&root)',"manifest-driven optional AI Sync model")
need(rust,'let mut primary_model: Option<String> = None;', "model-free project bootstrap")
need(rust,'if project_changed {',"project switch lifecycle")
need(rust,'let _ = child.kill();',"stale Rojo process cleanup")
need(web,'projectUiStorageKey(projectId)',"project-scoped frontend state")
need(rust,'const HISTORY_GENERATION: &str = "standalone-v1";',"standalone history generation")
need(rust,'BACKUP_REF_PREFIX',"standalone backup ref namespace")
need(rust,'store.history_generation != HISTORY_GENERATION',"legacy history reset")
need(web,'roflowStandaloneProjectRootV1',"fresh standalone root storage")
need(web,'roflowStandaloneProjectUiV1:',"fresh standalone UI storage")
need(web,'clearProjectDom()',"project switch state reset")
need(web,'status.runtimeProbeEnabled===true',"project-scoped runtime probe")
need(web,'status.releaseGateTaskIds',"project-scoped release gate")
need(studio,'PROJECT_SCOPE=new URLSearchParams(location.search).get("project")',"UI Studio project scope")
need(studio,'status?.uiStates',"manifest-driven UI Studio rail")
need(studio,'function previewVisible(n)',"generic authored preview")
need(studio,'let PRIMARY_MODEL_PATH=""',"project-defined primary UI model")
need(studio,'state.targetPath===PRIMARY_MODEL_PATH',"project primary model merge")
need(studio,'roflow-request-project-picker',"UI Studio delegates project switching")
need(web,'roflow-request-project-picker',"shell owns project switching")

runtime_sources=rust+"\n"+web+"\n"+studio
for forbidden,label in [
    ('localStorage.setItem("roflowPlannerShowCompleted"', "global Planner completion preference"),
    ('const PLANNER_DEFAULTS_PATH: &str = "tools/roflow/planner-defaults.json";', "embedded game planner authority"),
    ('BloomUI.model.json', "Bloom-specific UI model path"),
    ('BloomLoadingTemplate.model.json', "Bloom-specific loading model path"),
    ('BloomEditorEngineV2', "Bloom-specific editor engine name"),
    ('Choose Bloom_RNG project', "Bloom-specific project picker"),
]:
    if forbidden in runtime_sources:
        raise AssertionError(f"{label} must not exist in standalone runtime sources")

print("RoFlow project-scope contract: PASS")
print("Planner, UI state, build output and runtime/release gates are project-owned.")

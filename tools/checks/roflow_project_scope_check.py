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
need(web,'projectUiStorageKey(projectId)',"project-scoped frontend state")
need(web,'clearProjectDom()',"project switch state reset")
need(web,'status.runtimeProbeEnabled===true',"project-scoped runtime probe")
need(web,'status.releaseGateTaskIds',"project-scoped release gate")
need(studio,'PROJECT_SCOPE=new URLSearchParams(location.search).get("project")',"UI Studio project scope")
need(studio,'status?.uiStates',"manifest-driven UI Studio rail")
need(studio,'function previewVisible(n)',"generic authored preview")

for forbidden,label in [
    ('localStorage.setItem("roflowPlannerShowCompleted"', "global Planner completion preference"),
    ('const PLANNER_DEFAULTS_PATH: &str = "tools/roflow/planner-defaults.json";', "embedded Bloom planner authority"),
]:
    if forbidden in web+rust:
        raise AssertionError(f"{label} must not be global/embedded")

print("RoFlow project-scope contract: PASS")
print("Planner, UI state, build output and runtime/release gates are project-owned.")

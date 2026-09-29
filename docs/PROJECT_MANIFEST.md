# RoFlow project manifest

A connected Roblox/Rojo repository can optionally add a root-level `roflow.project.json`.

RoFlow treats this file as the project's UI/workflow contract. The application itself stays in the standalone RoFlow repository.

## Schema v1

```json
{
  "schemaVersion": 1,
  "projectId": "stable-project-id",
  "displayName": "My Roblox Game",
  "plannerDefaultsPath": "roflow/planner-defaults.json",
  "buildFile": "MyGame.rbxl",
  "runtimeProbeEnabled": false,
  "releaseGateTaskIds": [],
  "uiStates": [
    {
      "id": "hud",
      "label": "HUD",
      "root": "HUD",
      "modelPath": "src/StarterGui/GameUI.model.json",
      "iconAssetId": ""
    }
  ]
}
```

### projectId

Must remain stable if the folder moves. It separates project UI state, planner state and local metadata from other projects.

If omitted, RoFlow derives a fallback ID from the Git origin URL, or from the canonical folder path when no origin exists.

### displayName

Shown in RoFlow. If omitted, the project-folder name is used.

### plannerDefaultsPath

Optional repository-relative JSON file with:

```json
{
  "schemaVersion": 1,
  "today": [],
  "roadmap": []
}
```

When it is missing, RoFlow starts with an empty project Planner. It never injects another game's roadmap.

Local checkbox state and history are stored in the project's ignored `.roflow/planner.json`.

### buildFile

Rojo build output for Build / Open Studio. If omitted, RoFlow derives a safe `.rbxl` filename from `default.project.json`.

### runtimeProbeEnabled

Enables the RuntimeProbe/PersistenceProbe dashboard contract. Projects that do not use those probes should leave it false.

### releaseGateTaskIds

Optional Planner task IDs used for the release gate. An empty list means the project has no configured manual release gate.

### uiStates

Defines the UI Studio rail. Every entry is project-owned:

- `id`: stable state ID.
- `label`: displayed name.
- `root`: authored Roblox Instance name focused by UI Studio.
- `modelPath`: repository-relative Rojo `.model.json` file.
- `iconAssetId`: optional Roblox image asset ID.

RoFlow only allows UI Studio reads/writes to model paths declared by the current project. AI Sync uses the first declared UI state's model as its semantic merge model.

## Local project data

RoFlow stores project-local metadata under:

```text
.roflow/
  planner.json
  tasks.json
  backups.json
```

Projects should ignore `.roflow/` and `.recovery/`.

Backups, tasks and planner stores carry the project ID. The frontend and UI Studio also namespace their local state by the same project ID.

## Switching projects

On A → B:

1. RoFlow saves A's frontend state.
2. Any Rojo Serve process owned by A is stopped.
3. The backend switches to B's canonical root.
4. Old Planner, tasks, health, runtime, diff and output UI are cleared immediately.
5. B's project manifest and local stores are loaded.
6. UI Studio is recreated with B's project ID and B's `uiStates`.

Returning B → A restores A's own state instead of reusing B's.

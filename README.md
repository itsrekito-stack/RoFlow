# RoFlow

RoFlow is a standalone Windows desktop workflow hub for Roblox/Rojo projects.

The app is no longer owned by a specific Bloom RNG repository. Projects are connected at runtime and provide their own optional `roflow.project.json` manifest.

## Project isolation

Project-specific state is isolated by project identity:

- Planner + goals
- task history
- versioned backups
- selected file / current page
- UI Studio preferences and recovery model
- build output name
- RuntimeProbe / release-gate configuration
- UI Studio state rail

Local project metadata stays inside the selected project's ignored `.roflow/` directory. RoFlow application settings remain global.

A project without a RoFlow manifest gets safe generic defaults. It does **not** inherit Bloom RNG's roadmap or UI states.

## Project manifest

Example:

```json
{
  "schemaVersion": 1,
  "projectId": "my-roblox-game",
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
      "modelPath": "src/StarterGui/BloomUI.model.json"
    }
  ]
}
```

## Development

```powershell
npm install
npm run dev
```

Build the NSIS installer:

```powershell
npm run build
```

The Windows workflow performs project-scope checks, Safe AI Sync checks, `cargo check`, then builds and publishes the update-channel installer.

# RoFlow UI Studio

RoFlow UI Studio is the project-scoped visual editor for authored Roblox ScreenGui models.

It is bundled inside the standalone RoFlow desktop app. The selected game repository does not need to contain RoFlow or a copy of the editor.

## Project-owned UI states

The left UI state rail is generated from the selected project's root-level `roflow.project.json`.

Example:

```json
{
  "schemaVersion": 1,
  "projectId": "my-game",
  "uiStates": [
    {
      "id": "inventory",
      "label": "Inventory",
      "root": "InventoryPanel",
      "modelPath": "src/StarterGui/GameUI.model.json"
    },
    {
      "id": "workshop",
      "label": "Workshop",
      "root": "WorkshopPanel",
      "modelPath": "src/StarterGui/GameUI.model.json"
    }
  ]
}
```

RoFlow does not ship a fixed list such as Inventory, Trials, Season or World UI. If a project does not declare a state, that state does not appear.

Clicking a state focuses its authored Roblox Instance subtree. Clicking the active state again returns to an empty workspace.

## Model access

UI Studio can read and write only model paths declared by the current project's `uiStates`.

This prevents a state from one project from opening or modifying an unrelated file in another project.

The first declared UI model is also the semantic merge model used by desktop Safe AI Sync.

## Project isolation

UI Studio preferences use the same project ID as RoFlow:

- viewport and zoom
- editor panel sizes
- selected model path
- last-good recovery model
- editor preferences

Switching project A → B creates/loads B's namespace. Returning B → A restores A's namespace.

## Authored UI principle

Persistent interface structure should exist as Roblox GUI Instances in Rojo model JSON.

Runtime Luau should bind data and events to authored UI and may clone authored templates for dynamic lists. It should not recreate the permanent interface from scratch unless a runtime-only object genuinely requires it.

## Canvas

The editor supports:

- real viewport dimensions
- UDim / UDim2 / AnchorPoint
- ZIndex
- colors and transparency
- TextLabel / TextButton / TextBox
- ImageLabel / ImageButton
- ScrollingFrame
- UICorner / UIStroke
- UIPadding
- UIListLayout / UIGridLayout
- UIScale
- drag / resize
- multi-select
- group / ungroup
- duplicate
- Explorer and Inspector
- smart guides and snapping
- undo / redo

## Desktop workflow

Use UI Studio from RoFlow:

1. Choose the Roblox/Rojo Project Folder.
2. RoFlow reads `roflow.project.json`.
3. Open **UI Studio**.
4. Select one of that project's declared UI states.
5. Edit the authored Roblox GUI model.
6. Save or run Safe AI Sync from RoFlow.

Safe AI Sync is implemented by the desktop Rust backend and preserves local work around Git pulls.

## Developer browser fallback

`ui-studio/server.py` exists only for editor development.

Run:

```powershell
python ui-studio/server.py --project C:\path\to\your\game
```

It provides the static editor, Roblox thumbnails and optional Git status.

For safety, browser fallback does **not** mutate Git and does not implement Safe AI Sync. Use RoFlow desktop for project synchronization.

## Keyboard shortcuts

- Ctrl+Z / Ctrl+Y — undo / redo
- Ctrl+D — duplicate
- Ctrl+C / Ctrl+V — copy / paste GUI object
- Delete — delete
- F2 — rename
- Arrow keys — nudge 1 px
- Shift+Arrow — nudge by Snap
- Ctrl+F — Explorer search
- Ctrl+G — group
- Ctrl+Shift+G — ungroup
- Ctrl+S — Save
- 0 — Fit viewport
- Esc — close the active UI state / selection context

## Rendering precision

UI Studio writes the authored Rojo model JSON rather than a screenshot.

Some browser rendering details can only approximate Roblox Engine behavior, such as exact font rasterization, complex AutomaticSize cases, gradients, slicing and platform CoreGui inset. The stored Roblox properties are still preserved.

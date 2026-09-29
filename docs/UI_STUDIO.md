# Bloom UI Studio

Bloom UI Studio — визуальный редактор Roblox ScreenGui внутри desktop-приложения RoFlow.

Основной режим работы больше не строится вокруг старой схемы DESIGN/PREVIEW и mock HTML. Редактор работает от **UI STATES**: выбираешь конкретное состояние игры и редактируешь настоящие Roblox GUI instances из Rojo-модели.

## Главный принцип

Постоянный игровой интерфейс должен быть authored в Roblox GUI-моделях.

- Основной HUD и окна: `src/StarterGui/BloomUI.model.json`
- Loading Screen: `src/ReplicatedFirst/BloomLoadingTemplate.model.json`
- Runtime Luau связывает данные, события и клонирует authored templates для динамических списков.
- Скрипты не должны собирать постоянный ScreenGui через `Instance.new()`.
- World-space объекты могут создаваться runtime, но их визуальные UI-прототипы хранятся в `WorldUIPrototypes` и редактируются через UI Studio.

## UI STATES

Левая вертикальная панель — основной способ навигации:

- HUD
- Inventory
- Workshop
- Field Guide
- Map
- Trials
- Settings
- Plant
- Season
- Replay
- Cards
- Reward
- Toast
- Tutorial
- Active Boosts
- World UI
- Loading

Нажатие на state показывает только его authored Roblox UI на canvas и переводит Explorer/Inspector в контекст этого интерфейса.

**Повторное нажатие на уже активный state закрывает его и возвращает пустой рабочий стол.**

Loading автоматически переключает редактор на отдельную `BloomLoadingTemplate.model.json`. Возврат к любому игровому state автоматически возвращает `BloomUI.model.json`.

## Desktop workflow

Используй Bloom UI Studio через **RoFlow**. Это основной desktop workflow.

Верхняя панель:

- **Project** — выбрать проект.
- **Save** — записать текущую Roblox GUI-модель.
- **AI SYNC** — забрать актуальный `main`, безопасно объединить authored UI и перезагрузить текущую модель.
- Undo / Redo.
- Import / Export JSON.
- Copy model for AI.

Старый запуск через локальную HTML-страницу остаётся только как developer fallback для отладки самого редактора; это не основной пользовательский workflow.

## Canvas

Canvas использует реальные Roblox viewport размеры:

- 1366×768
- 1280×720
- 1920×1080
- 1440×900
- mobile/custom

Можно загрузить screenshot Roblox как background и подгонять интерфейс поверх реального кадра.

Поддерживаются:

- UDim2 / AnchorPoint
- ZIndex
- transparency / colors
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
- exact Inspector
- smart guides
- snapping
- undo / redo

## Explorer и Inspector

Когда UI STATE не выбран, workspace и Explorer остаются пустыми — это нормальное состояние.

После выбора state редактор фокусирует соответствующий authored root. Из Explorer можно менять иерархию, а через Inspector — реальные Roblox properties.

Не создавай отдельный декоративный HTML-preview вместо Roblox UI. Если элемент должен существовать в игре, он должен существовать в одной из authored GUI-моделей.

## Динамические интерфейсы

Некоторые списки зависят от профиля игрока: Inventory cards, Settings rows, Trials, Field Guide rows и т. п.

Для них в ScreenGui существуют authored templates/state kits. Runtime может:

1. найти authored template;
2. клонировать его;
3. подставить серверные данные;
4. подключить события.

Геометрия, stroke, corner, padding, fonts, icons и базовый стиль остаются редактируемыми в UI Studio.

## Горячие клавиши

- Ctrl+Z / Ctrl+Y — undo / redo
- Ctrl+D — duplicate
- Ctrl+C / Ctrl+V — copy / paste GUI object
- Delete — delete
- F2 — rename
- Arrow keys — nudge 1 px
- Shift+Arrow — nudge по Snap
- Ctrl+F — поиск в Explorer
- Ctrl+G — group
- Ctrl+Shift+G — ungroup
- Ctrl+S — Save
- 0 — Fit viewport
- Esc — закрыть активный UI STATE / свернуть multi-selection

## Geometry

Geometry helpers существуют только в редакторе и не попадают в Roblox:

- rulers;
- viewport center axes;
- safe inset line;
- live X/Y/W/H;
- distances to parent;
- smart guides;
- smart snap к родителю, viewport и соседям;
- Alt временно отключает smart snap.

## Точность

Редактор сохраняет Rojo model JSON напрямую. UDim/UDim2 offsets нормализуются до целых значений перед записью.

Некоторые вещи рендерятся приблизительно относительно Roblox Engine: точная Gotham rasterization, отдельные AutomaticSize случаи, сложные UIGradient sequences, image slicing и platform-specific CoreGui inset. Сами свойства при этом не теряются.

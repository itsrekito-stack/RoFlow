# Bloom UI Studio — Editor Engine V2

Engine V2 replaces the authored viewport renderer with a Canvas2D scene engine.

## Ownership

- Canvas2D owns Roblox GuiObject drawing, scene traversal, clipping, image/text rendering, z-order and hit-testing.
- UI STATES, Explorer, Inspector, toolbar and dialogs remain normal desktop-editor DOM.
- #guiRoot now receives invisible geometry proxies only. They keep mature transform/measurement tools compatible while visual rendering no longer creates nested HTML for every Roblox UI object.
- BloomUI.model.json and BloomLoadingTemplate.model.json remain the authored source of truth.

## Input

- Two-finger trackpad scroll pans the stage through the native scroller.
- Pinch / Ctrl+wheel uses the existing bounded zoom path.
- Canvas hit-testing routes selection and drag into the existing authored-model transform transaction.
- Resize handles remain the mature overlay implementation in this migration so editing behavior does not regress.

## Rendering

Engine V2 supports Frame/ScrollingFrame, text classes, image classes, UICorner, UIStroke, UIPadding, UIListLayout, UIGridLayout, UIAspectRatioConstraint, clipping, ZIndex, rotation, runtime preview visibility/text/image overrides, and hidden-object authoring opacity.

Images are cached asynchronously. RoFlow thumbnail resolution still uses the native bridge; standalone web mode still uses the local thumbnail endpoint.

## Performance direction

The expensive nested visual DOM tree is no longer built on each render. A single canvas paints the viewport. Lightweight invisible proxy rectangles are temporary compatibility geometry for Inspector, smart guides, group operations and resize math. They can be retired independently in a later engine pass without changing the authored model format.

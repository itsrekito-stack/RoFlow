# RoFlow UI Studio — Editor Engine V2

Engine V2 is the Canvas2D scene renderer used by RoFlow UI Studio.

## Ownership

- Canvas2D owns Roblox GuiObject drawing, traversal, clipping, image/text rendering, z-order and hit-testing.
- Project-defined UI states, Explorer, Inspector, toolbar and dialogs remain normal editor DOM.
- `#guiRoot` receives lightweight invisible geometry proxies for transform/measurement tooling.
- The connected project's declared Rojo `.model.json` files remain the authored source of truth.

RoFlow does not assume a particular game name or a fixed UI filename. Model paths and focus roots come from `roflow.project.json`.

## Input

- Two-finger trackpad scroll pans the stage through the native scroller.
- Pinch / Ctrl+wheel uses bounded zoom.
- Canvas hit-testing routes selection and drag into authored-model transform transactions.
- Resize handles remain DOM overlays so editing behavior stays predictable.

## Rendering

Engine V2 supports Frame/ScrollingFrame, text classes, image classes, UICorner, UIStroke, UIPadding, UIListLayout, UIGridLayout, UIAspectRatioConstraint, clipping, ZIndex, rotation and hidden-object authoring opacity.

Images are cached asynchronously. Desktop mode resolves Roblox thumbnails through the native RoFlow bridge; browser developer fallback uses its thumbnail endpoint.

## Performance direction

The visual viewport is painted by one canvas instead of rebuilding a deep visual DOM tree on every render. Geometry proxies can be reduced later without changing the authored model format or the project manifest contract.

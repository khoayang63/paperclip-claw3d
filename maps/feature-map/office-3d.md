---
navigation: {"section":"Oversight and operation","sectionOrder":70,"order":55}
---

# Native 3D Office

Explore a company's virtual multi-floor office in Three.js, inspect live agent states and control-plane stations, edit rooms/desks/project whiteboards, and watch A\* pathfinding movement and daily time-lapse replays.

Feature ID: `office-3d`.

Implementation: [Office3DPage](../../ui/src/pages/Office3D/Office3DPage.tsx), [OfficeSceneEngine](../../ui/src/pages/Office3D/scene/OfficeSceneEngine.ts), [useOfficeControlPlaneBridge](../../ui/src/pages/Office3D/useOfficeControlPlaneBridge.ts), [office-layout route](../../server/src/routes/office-layout.ts).

Agent access: [companion](../agent-access-map/office-3d.md).

## Sub-features

- `scene-navigation`: `office-3d/scene-navigation` — navigate 3D floor via WASD, A\* Click-to-Move, RPG/Overview toggle (`V`), Minimap teleport, and `?agent=` deep links.
- `control-plane-stations`: `office-3d/control-plane-stations` — inspect and act on agent desks, approvals, workspaces, HR hiring, routines, artifacts, project whiteboards, and floor elevators using existing APIs.
- `build-mode-persistence`: `office-3d/build-mode-persistence` — add buildings/floors, draw doored rooms, place desks/furniture, export/import blueprints, and persist `OfficeLayout` plus `AgentSkinMap`.
- `agent-movement-replay`: `office-3d/agent-movement-replay` — observe A\* doorway pathfinding for idle breaks, task assignments, handoffs, meetings, and scrubbable 5x/10x historical Time-lapse Replay.

## How to get to it (user POV)

### `office-view`

Open `/office` inside a company (or click **3D Office** in the left sidebar); legacy `/3d-office` redirects to `/office`.

### `agent-deep-link`

Open an Agent detail page and choose **View in 3D Office** from the action menu to jump directly to `/office?agent=<agentId>`.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Ensure WebGL is available in the browser and at least one company agent exists.

### `office-view`

Automated: [Office3D page tests](../../ui/src/pages/Office3D/Office3DPage.test.tsx), [navGrid A* tests](../../ui/src/pages/Office3D/model/navGrid.test.ts), [replay tests](../../ui/src/pages/Office3D/model/replay.test.ts), [agent state tests](../../ui/src/pages/Office3D/model/agentState.test.ts), and [layout routes tests](../../server/src/__tests__/office-layout-routes.test.ts) cover scene logic, HUD interactions, and layout persistence authorization.

Manual: Load `/office`, verify WebGL rendering, test Minimap teleport, toggle Environment time/weather controls, enter Build Mode to edit and save a room/desk, assign a real lightweight task to confirm the assigned agent walks via A\* through room doorways back to its desk, test **Call Meeting** / **End Meeting**, and scrub **Replay** at `5x` / `10x`.

### `agent-deep-link`

Automated: [AgentDetailPage tests](../../ui/src/pages/AgentDetailPage.test.tsx) cover detail navigation; [Office3DPage tests](../../ui/src/pages/Office3D/Office3DPage.test.tsx) cover initial mounting.

Manual: From Agent Detail, invoke **View in 3D Office**, verify `/office` loads on the agent's floor and focuses its desk.

## Gotchas

- Headless browsers or environments without WebGL intentionally render [WebGLFallback](../../ui/src/pages/Office3D/components/WebGLFallback.tsx) with links back to Org Chart and Dashboard.
- Global Paperclip single-key shortcuts are suppressed while the 3D viewport holds focus so `WASD`, `E`, and `V` remain responsive.
- Color tokens and fixed overlay dimensions are defined in [index.css](../../ui/src/index.css) to satisfy `check-token-gates`.

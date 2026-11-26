# Native 3D Office — agent access

Product map: [Native 3D Office](../feature-map/office-3d.md).

Feature ID: `office-3d`.

Review date: 2026-11-24. Source path: [office-layout routes](../../server/src/routes/office-layout.ts) and [Office3DPage](../../ui/src/pages/Office3D/Office3DPage.tsx).

The 3D Office is a board-facing visual control plane layered over existing Paperclip APIs plus company-scoped layout persistence. Follow the [shared map contract](../README.md) when updating access records.

## `scene-navigation`

Capability ID: `office-3d/scene-navigation`.

Review: `baseline`.

API: `not-applicable` — client-side Three.js camera/navigation projection reading existing company agent/run queries.

Agent access: `not-applicable` — UI-only viewport navigation surface; agents do not drive the 3D camera.

Policy: Company read access governs underlying entity queries fetched for the scene.

Evidence: `source-only` — [OfficeSceneEngine](../../ui/src/pages/Office3D/scene/OfficeSceneEngine.ts) and [navGrid](../../ui/src/pages/Office3D/model/navGrid.ts).

Verification: `not-run` — pure unit tests cover A\* pathfinding; live browser navigation checks are separate.

Gaps: Touch viewports lock to Overview mode and omit desktop RPG WASD controls.

## `control-plane-stations`

Capability ID: `office-3d/control-plane-stations`.

Review: `baseline`.

API: `present` — delegates to existing Paperclip endpoints such as `POST /api/agents/{agentId}/pause`, `POST /api/approvals/{id}/approve`, and `POST /api/companies/{companyId}/issues`.

Agent access: `partial` — delegates directly to underlying company-scoped station endpoints, each enforcing its own actor permissions and approval gates.

Policy: Action buttons in [StationModal](../../ui/src/pages/Office3D/components/StationModal.tsx) are hidden for viewer roles and enforced server-side on each delegated endpoint.

Evidence: `source-only` — [useOfficeControlPlaneBridge](../../ui/src/pages/Office3D/useOfficeControlPlaneBridge.ts) and [StationModal](../../ui/src/pages/Office3D/components/StationModal.tsx).

Verification: `not-run` — no dedicated sandbox agent qualification on the 3D modal wrappers; underlying APIs carry their own companions.

Gaps: Delegates mutations rather than defining station-specific server routes.

## `build-mode-persistence`

Capability ID: `office-3d/build-mode-persistence`.

Review: `baseline`.

API: `present` — representative operations:

- `GET /api/companies/{companyId}/office-layout`
- `PUT /api/companies/{companyId}/office-layout`

Agent access: `restricted` — same-company agents may read via `GET /api/companies/{companyId}/office-layout`; `PUT /api/companies/{companyId}/office-layout` enforces `assertBoard` so agents and viewer roles receive `403`.

Policy: Same-company scope via `assertCompanyAccess`; writes additionally require non-viewer board membership via `assertBoard`, validate against `upsertCompanyOfficeLayoutSchema`, and record `office_layout.updated` activity logs.

Evidence: `source-only` — [office-layout routes](../../server/src/routes/office-layout.ts), [office-layout service](../../server/src/services/office-layout.ts), and [office-layout route tests](../../server/src/__tests__/office-layout-routes.test.ts).

Verification: `not-run` — mocked route tests cover 200/400/401/403/404 authorization branches locally; deployed agent credential checks not run.

Gaps: UI gracefully falls back to `localStorage` if an older server binary returns `404` for `/office-layout`.

## `agent-movement-replay`

Capability ID: `office-3d/agent-movement-replay`.

Review: `baseline`.

API: `present` — replay fetches historical timelines via `GET /api/companies/{companyId}/activity` and `GET /api/companies/{companyId}/heartbeat-runs`.

Agent access: `partial` — read-only replay reconstruction consumes existing company activity and run history endpoints.

Policy: Same-company read access and issue visibility filters apply to fetched activity and heartbeat run history.

Evidence: `source-only` — [replay model](../../ui/src/pages/Office3D/model/replay.ts), [ReplayBar](../../ui/src/pages/Office3D/components/ReplayBar.tsx), and [replay tests](../../ui/src/pages/Office3D/model/replay.test.ts).

Verification: `not-run` — unit tests verify state reconstruction over synthetic intervals; live replay verification with running backend telemetry is separate.

Gaps: Live handoff beams and A\* animations run purely client-side without persistent coordinate storage.

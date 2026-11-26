# Thiết kế Chi tiết: Tích hợp Paperclip Control Plane vào 3D Office

> Tài liệu bổ sung cho [2026-11-24-native-3d-office.md](file:///c:/Users/OS/Desktop/paperclip/doc/plans/2026-11-24-native-3d-office.md).
> Mục tiêu: Biến các module quản trị cốt lõi của Paperclip thành **vật thể vật lý tương tác trực tiếp trong thế giới 3D**, thay vì để 3D Office chỉ là màn hình quan sát thụ động.

> [!IMPORTANT]
> 3D Office **không tạo API hay đường tắt mới** cho hành động. Mọi thao tác (Approve/Reject, Pause/Resume, Hire, Assign Task) gọi đúng client trong `ui/src/api/*` như các trang 2D, để giữ nguyên approval gate, budget hard-stop, kiểm tra quyền và activity log.

---

## 1. Danh sách Tính năng & Nguồn Dữ liệu

| Vật thể 3D trong Văn phòng | Nghiệp vụ Paperclip | API Client sẵn có (`ui/src/api/`) | Tương tác `[E]` & Phản hồi trực quan |
| :--- | :--- | :--- | :--- |
| **Bàn Duyệt Hồ Sơ (Approval Desk)** | Approvals & Decision Queue | `approvals.ts`, `decisions.ts`, `decisionQueues.ts`, `attention.ts` | Chồng hồ sơ phát sáng + badge số lượng chờ duyệt; nhấn `[E]` mở danh sách duyệt (tái sử dụng UI duyệt hiện có) kèm âm thanh đóng dấu. |
| **Bảng Ngân Sách & Chi Phí (Budget Wall / Desk Meter)** | Costs & Budget Hard-stop | `costs.ts`, `budgets.ts` | Thanh năng lượng trên đầu agent & đèn bàn đổi màu theo % ngân sách; khi agent `paused` với `pauseReason = "budget"`, bàn nhấp nháy đỏ và nhân vật ngừng gõ. |
| **Tủ Máy Chủ Dự Án (Server Rack)** | Execution Workspaces & Service Ports | `execution-workspaces.ts`, `workspace-runtime-control.ts` | Mỗi workspace đang chạy là 1 rack đèn xanh/đỏ theo health; nhấn `[E]` xem log service hoặc mở preview URL. |
| **Quầy Tuyển Dụng (HR Reception)** | Hire Agent & Team Catalog | `agents.ts`, `teamCatalog.ts`, `approvals.ts` | Nhấn `[E]` mở luồng tuyển agent / cài đội ngũ từ Team Catalog. Agent `pending_approval` đứng chờ tại quầy cho tới khi được duyệt. |
| **Đồng Hồ Tác Vụ (Routines Clock)** | Routines / Scheduled Tasks | `routines.ts` | Hiển thị các routine sắp chạy; khi routine kích hoạt, đồng hồ gõ chuông nhẹ và highlight bàn agent thực thi. |
| **Kệ Trưng Bày (Artifacts Showcase)** | Artifacts & Deliverables | `artifacts.ts` | Hiển thị các sản phẩm mới xuất bản; nhấn `[E]` xem trước nhanh. |
| **Màn Hình Bàn Làm Việc (Inspect Monitor)** | Heartbeat Runs & Live Transcript | `heartbeats.ts`, `agent-observability.ts` | Nhấn `[E]` mở **Live Run Transcript** (log, tool calls có timestamp) của run hiện tại + link Execution Workspace nếu có. Không phải IDE. |
| **Bảng Trắng (Whiteboard)** | Issues, Goals, Projects | `issues.ts`, `goals.ts`, `projects.ts` | Nhấn `[E]` mở Kanban & tiến độ Goals; có thể gắn `targetEntityId` = projectId để thành bảng riêng của dự án. |

---

## 2. Bảng Ánh xạ Trạng thái Agent → Hoạt ảnh 3D

Nguồn trạng thái thật trong `packages/shared/src/constants.ts`:
* `AGENT_STATUSES` = `active`, `paused`, `idle`, `running`, `error`, `pending_approval`, `terminated`
* `HEARTBEAT_RUN_STATUSES` = `queued`, `scheduled_retry`, `running`, `succeeded`, `interrupted`, `failed`, `cancelled`, `timed_out`
* `PAUSE_REASONS` = `manual`, `budget`, `system`, `company_archived`, `import`, `setup`

Thứ tự ưu tiên (áp dụng quy tắc đầu tiên khớp):

| # | Điều kiện | `AgentVisualState` | Hoạt ảnh |
| :--- | :--- | :--- | :--- |
| 1 | `agent.status = terminated` | `hidden` | Ẩn nhân vật, giải phóng bàn |
| 2 | `agent.status = pending_approval` | `awaiting_hire` | Đứng chờ ở Quầy HR |
| 3 | `agent.status = paused` và `pauseReason = budget` | `paused_budget` | Đèn bàn đỏ nhấp nháy, gục đầu |
| 4 | `agent.status = paused` (lý do khác) | `paused` | Rời bàn, ngồi ở Lounge |
| 5 | `agent.status = error` hoặc run gần nhất `failed` / `timed_out` (trong 10 phút) | `error` | Icon ❗ đỏ, tiếng cảnh báo |
| 6 | Run hiện tại `running` + sự kiện gần nhất là tool call | `coding` | Gõ phím nhanh, màn hình sáng |
| 7 | Run hiện tại `running` + sự kiện gần nhất là message/reasoning, hoặc chưa có sự kiện | `thinking` | Chống cằm, icon 💭 |
| 8 | Run `queued` hoặc `scheduled_retry` | `waiting` | Ngồi chờ, icon đồng hồ cát |
| 9 | Đang tham gia phiên thảo luận nhiều agent (Giai đoạn 6) | `meeting` | Ngồi ở Phòng họp |
| 10 | Còn lại (`idle`, `active`) | `idle` | Ngồi thư giãn hoặc dạo ra Lounge |

> [!NOTE]
> Phân biệt `coding` / `thinking` dựa trên sự kiện `heartbeat.run.event` mà `LiveUpdatesProvider` đã nhận. Định dạng sự kiện khác nhau giữa các adapter, nên mapper phải **mặc định về `thinking`** khi không nhận diện được loại sự kiện, không được báo lỗi.

---

## 3. Hướng Triển khai Kỹ thuật

1. **Lớp Adapter dữ liệu `useOfficeControlPlaneBridge`:**
   * Dùng React Query (các query key sẵn có) + **`LiveUpdatesProvider` (WebSocket) dùng chung**, không mở kết nối thứ hai. Các sự kiện liên quan: `heartbeat.run.event`, `heartbeat.run.log`, `heartbeat.run.progress`, và activity theo `entityType` (`agent`, `issue`, `decision`...).
   * Tách **state tần suất cao** (log, tool calls → chỉ đọc khi mở modal) khỏi **state tần suất thấp** (`AgentVisualState`, số approval, % budget → dùng để đổi màu/hoạt ảnh) để không render lại toàn bộ Canvas khi có log mới.
   * Cập nhật snapshot cho cảnh 3D theo nhịp tối đa ~2 lần/giây (throttle).
2. **Hệ thống `InteractiveStation` thống nhất:**
   * Mọi vật thể tương tác dùng chung Proximity Detection (bán kính ~2.0m) và phát sự kiện `onInteract(station)`.
   * Station được sinh từ `FurnitureItem` / `DeskConfig` trong `OfficeLayout`, không khai báo cứng.
3. **Phân quyền hiển thị:**
   * Mỗi hành động có `requiredCapability`; hành động không đủ quyền thì ẩn hoặc vô hiệu hóa kèm tooltip giải thích. Server vẫn là nơi kiểm tra quyền cuối cùng; lỗi `403` phải hiện rõ cho người dùng, không bỏ qua lặng lẽ.
4. **Tuân thủ Design System (`DESIGN.md`):**
   * Modal/drawer tái sử dụng component có sẵn; dùng token CSS trong `ui/src/index.css`; chuỗi qua i18n.
   * `statusColorToken` là tên token ngữ nghĩa; màu thực được đọc từ CSS variables lúc chạy.

---

## 4. Các Interface Đề xuất

```typescript
import type { AgentStatus, HeartbeatRunStatus, PauseReason } from "@paperclipai/shared";

export type InteractiveStationKind =
  | "agent_desk"
  | "approval_desk"
  | "server_rack"
  | "hr_reception"
  | "routines_clock"
  | "artifacts_showcase"
  | "whiteboard"
  | "elevator";

export type StationStatusToken = "healthy" | "warning" | "critical" | "idle";

export interface InteractiveStation {
  id: string;
  kind: InteractiveStationKind;
  floorId: string;
  cell: [number, number]; // Ô lưới (x, z)
  rotation: 0 | 90 | 180 | 270;
  interactionRadius: number; // Mặc định 2.0 (mét)
  labelKey: string; // Translation key
  badgeCount?: number;
  statusToken?: StationStatusToken;
  targetEntityId?: string; // agentId, workspaceId, routineId, projectId...
}

export type AgentVisualState =
  | "hidden"
  | "awaiting_hire"
  | "paused_budget"
  | "paused"
  | "error"
  | "coding"
  | "thinking"
  | "waiting"
  | "meeting"
  | "idle";

/** Đầu vào thuần cho mapper — dễ unit test bằng Vitest. */
export interface AgentVisualStateInput {
  agentStatus: AgentStatus;
  pauseReason: PauseReason | null;
  currentRunStatus: HeartbeatRunStatus | null;
  lastRunFailedAt: string | null;
  lastRunEventKind: "tool_call" | "message" | "unknown" | null;
  inMeeting: boolean;
  now: number;
}

export type MapAgentVisualState = (input: AgentVisualStateInput) => AgentVisualState;

export interface AgentOfficeSnapshot {
  agentId: string;
  name: string;
  role: string;
  reportsTo: string | null;
  visualState: AgentVisualState;
  currentRunId: string | null;
  currentIssueIdentifier: string | null;
  runStartedAt: string | null;
  costTodayCents: number | null;
  budgetUtilizationPct: number | null; // null nếu agent không có ngân sách
}

export type OfficeActionCapability =
  | "approve"
  | "pause_resume_agent"
  | "assign_issue"
  | "hire_agent"
  | "edit_layout";

export interface OfficeControlPlaneSummary {
  companyId: string;
  pendingApprovalsCount: number;
  upcomingRoutines: Array<{ routineId: string; name: string; nextRunAt: string | null }>;
  runningWorkspaces: Array<{
    workspaceId: string;
    name: string;
    status: "healthy" | "unhealthy" | "stopped";
    previewUrl?: string;
  }>;
  recentArtifactsCount: number;
  agentsById: Record<string, AgentOfficeSnapshot>;
  allowedActions: OfficeActionCapability[];
}
```

> Tên field cụ thể (ví dụ đơn vị chi phí, cách lấy `nextRunAt`) phải được đối chiếu với response thật của từng API client khi triển khai; interface trên là hợp đồng phía UI cho cảnh 3D.

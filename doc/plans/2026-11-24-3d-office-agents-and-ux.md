# Thiết kế Chi tiết: Tương tác Agent-to-Agent & Trải nghiệm UX/QoL

> Tài liệu bổ sung cho [2026-11-24-native-3d-office.md](file:///c:/Users/OS/Desktop/paperclip/doc/plans/2026-11-24-native-3d-office.md).
> Mục tiêu: Nâng cao tính sống động trong hành vi của các Agent và bổ sung công cụ điều hướng nhanh (QoL) khi công ty mở rộng lên nhiều tầng và hàng chục agent.

---

## 1. Các Tính năng

### A. Điều hướng & Quản lý nhanh (UX / QoL — Giai đoạn 2–4)
1. **Minimap & Agent Radar:**
   * Radar 2D ở góc màn hình: mặt bằng tầng hiện tại, vị trí người chơi, chấm màu theo `AgentVisualState` (`coding`, `thinking`, `error`, `paused_budget`...).
2. **Quick Teleport / Agent Finder:**
   * Chọn agent từ danh sách tìm kiếm hoặc chấm trên Minimap → chuyển đúng tầng và bay camera tới bàn của agent đó.
3. **Chế độ RPG vs Overview (phím `V` hoặc nút HUD):**
   * **RPG Mode:** Camera góc nhìn thứ 3 bám theo nhân vật, `WASD` / Click-to-Move.
   * **Overview Mode:** Camera góc cao tự do toàn cảnh (kiểu *The Sims*), dùng cho quan sát và Build Mode; đây là chế độ duy nhất trên thiết bị cảm ứng.
   * Không dùng `Tab` vì phá điều hướng bàn phím của trình duyệt.
4. **Hover Info Card:**
   * Rê chuột lên agent: tên, vai trò, issue đang làm, thời lượng run, chi phí hôm nay. Không cần lại gần hay nhấn `[E]`.
5. **Marker thông báo trong 3D & Deep link:**
   * Biểu tượng nổi trên đầu agent khi run lỗi, hoặc trên Bàn Duyệt khi có approval mới; marker ngoài khung nhìn hiển thị mũi tên ở rìa màn hình.
   * Deep link: `office?agent=<agentId>` hoặc `office?floor=<floorId>`; thêm nút **"Xem trong văn phòng"** ở trang Agent Detail. Click toast liên quan đến agent khi đang ở trang Office → camera bay tới agent.
6. **Focus / Picture-in-Picture (PiP):**
   * Khi mở Chat hoặc Inspect Monitor, cảnh 3D thu nhỏ ở góc (hoặc làm nền mờ) và giảm tần suất render.
7. **Blueprint Export / Import:**
   * Xuất/nhập `OfficeLayout` dạng JSON (có `schemaVersion`); khi nhập, các `assignedAgentId` không thuộc công ty hiện tại bị xóa. Giai đoạn 6 có thể tích hợp vào `CompanyExport` / `CompanyImport`.

### B. Tự sinh Văn phòng từ OrgChart (Giai đoạn 3)
* Dựa trên `agent.reportsTo`: agent gốc → Phòng CEO (Tầng 1); mỗi manager → một phòng; các agent báo cáo trực tiếp → bàn trong phòng đó.
* Phòng xếp theo lưới, có cửa hướng ra hành lang chung; vượt sức chứa tầng → sinh thêm tầng mới.
* Hàm sinh layout là **hàm thuần, kết quả ổn định** (cùng đầu vào → cùng layout) để test bằng Vitest.

### C. Hành vi Agent-to-Agent nâng cao (Giai đoạn 6)
1. **Handoff Walk & Chat Bubbles:**
   * Khi issue được giao lại hoặc agent tag agent khác (sự kiện activity `issue.updated` / comment), agent nguồn đi sang bàn agent đích (cùng tầng) hoặc hiện tia kết nối (khác tầng), kèm bong bóng chat ngắn.
2. **Phòng Họp tự động (Live Meeting Room):**
   * Khi có phiên thảo luận nhiều agent (`BoardChat`), các agent tham gia di chuyển tới bàn họp.
3. **Tìm đường tránh tường (A\* trên `FloorNavGrid`):**
   * Lưới điều hướng sinh từ `FloorConfig`: tường phòng chặn trừ các ô trong `RoomConfig.doors`; bàn và nội thất chặn.
4. **Time-lapse Replay:**
   * Dựa trên `activity.ts` / `workTimeline.ts`, thanh trượt phát lại hoạt động trong ngày ở tốc độ `5x – 10x`.

---

## 2. Hướng Triển khai Kỹ thuật

1. **`CameraRig` duy nhất:**
   * Điều khiển `camera.position` và `controls.target` bằng `Vector3.lerp()`. Teleport khác tầng: cập nhật `activeFloorId` trước rồi lerp tới bàn agent.
   * Khi `prefers-reduced-motion`: chuyển camera tức thì, không bay.
2. **Xây dựng `FloorNavGrid`:**
   * Đánh dấu ô chặn từ biên phòng (trừ ô cửa), `DeskConfig`, `FurnitureItem`. Rebuild khi Build Mode lưu thay đổi (< 1ms cho lưới 30x30).
   * Giai đoạn đầu: agent di chuyển theo đường thẳng tới cửa phòng rồi tới đích; A\* đầy đủ ở Giai đoạn 6.
3. **Giới hạn Bubble & nhãn:**
   * Chỉ hiển thị bong bóng chat / nhãn tên cho tối đa 5–10 agent gần camera.
4. **Deep link & URL state:**
   * Đọc/ghi query string qua router hiện có của Paperclip; URL không chứa dữ liệu nhạy cảm (chỉ id).

---

## 3. Các Interface Đề xuất

```typescript
export type CameraControlMode = "rpg" | "overview" | "follow_agent" | "pip";

/** Trạng thái hiển thị — KHÔNG lưu trong OfficeLayout. */
export interface OfficeNavigationState {
  cameraMode: CameraControlMode;
  activeBuildingId: string;
  activeFloorId: string;
  focusedAgentId: string | null;
  hoveredAgentId: string | null;
  showMinimap: boolean;
}

export interface OfficeDeepLinkParams {
  agent?: string; // agentId
  floor?: string; // floorId
}

export interface WorldMarker {
  id: string;
  kind: "run_error" | "approval_pending" | "task_completed" | "budget_paused";
  floorId: string;
  cell: [number, number];
  targetEntityId: string;
  createdAt: number;
  expiresAt: number | null; // null = giữ tới khi được xử lý
}

/** Hàm thuần sinh layout từ OrgChart. */
export interface OrgLayoutAgentInput {
  agentId: string;
  name: string;
  role: string;
  reportsTo: string | null;
  status: import("@paperclipai/shared").AgentStatus;
}

export type GenerateLayoutFromOrg = (
  companyId: string,
  agents: OrgLayoutAgentInput[],
  options?: { maxDesksPerFloor?: number; gridSize?: [number, number] },
) => import("./office-layout").OfficeLayout;

export interface AgentMovementTask {
  agentId: string;
  purpose: "return_desk" | "handoff" | "meeting" | "lounge_break";
  targetFloorId: string;
  targetCell: [number, number];
  pathWaypoints: Array<[number, number]>;
  bubbleTextKey?: string; // Translation key
  startedAt: number;
}

export interface FloorNavGrid {
  floorId: string;
  width: number;
  depth: number;
  /** Mảng 1 chiều (z * width + x): 0 = đi được, 1 = vật cản */
  blockedCells: Uint8Array;
}

export type FindPath = (
  grid: FloorNavGrid,
  from: [number, number],
  to: [number, number],
) => Array<[number, number]> | null; // null = không có đường

/** File Blueprint Export dùng lại đúng schema OfficeLayout. */
export interface OfficeBlueprintExport {
  kind: "paperclip.office-blueprint";
  exportedAt: string;
  sourceCompanyName: string;
  layout: import("./office-layout").OfficeLayout;
}
```

> `OfficeLayout`, `FloorConfig`, `RoomConfig`… được định nghĩa ở Mục 7 của [kế hoạch chính](file:///c:/Users/OS/Desktop/paperclip/doc/plans/2026-11-24-native-3d-office.md); đường dẫn `./office-layout` chỉ minh họa module chứa schema khi triển khai.

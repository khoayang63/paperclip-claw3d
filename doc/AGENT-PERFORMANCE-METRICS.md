# Tài liệu Giải thích Các Chỉ số Hiệu suất Agent (Agent Performance Metrics)

Tài liệu này giải thích chi tiết ý nghĩa, công thức tính và cách sử dụng các chỉ số trên trang **Performance** (`/:companyPrefix/performance`), khung **Board Quality Review** trên trang Issue, và thanh tóm tắt **30d Performance** trong 3D Office.

> Nguồn tính toán chuẩn: [`server/src/services/performance.ts`](../server/src/services/performance.ts)

---

## 1. Bộ lọc Thời gian (Time Window)

Tất cả các chỉ số trên bảng đều được tính **tổng hợp / trung bình trong khoảng thời gian đang chọn**:

- **`7d`**: 7 ngày gần nhất (tính theo UTC).
- **`30d`** *(mặc định)*: 30 ngày gần nhất.
- **`All time`**: Toàn bộ lịch sử từ khi tạo công ty.

Nguyên tắc lọc bản ghi theo kỳ:
- **Issues (Tasks)**: lọc theo `completedAt ?? updatedAt ?? createdAt`.
- **Heartbeat Runs**: lọc theo `startedAt ?? createdAt`.
- **Reopen Events**: lọc các bản ghi `activity_log` có `action = "issue.updated"` chuyển trạng thái từ `done` sang trạng thái đang mở (`todo`, `in_progress`, `in_review`, `backlog`, `blocked`) theo `createdAt`.
- **Board Quality Reviews**: lọc theo `updatedAt ?? createdAt`.

---

## 2. Giải thích từng cột trong bảng Agent Leaderboard

| Cột | Ý nghĩa | Công thức & Ghi chú |
|---|---|---|
| **Agent** | Tên agent, vai trò (`role`/`title`) và model LLM cấu hình. | Lấy từ cấu hình agent hiện tại. |
| **Score** | **Điểm hiệu suất tổng hợp (0–100)**. | Trung bình có trọng số của `Run Success` (45%), `100 − Reopen Rate` (25%) và `Board Rating` (30%). Xem chi tiết ở [Mục 3](#3-công-thức-tính-score-0100). |
| **Tasks Done** | Số task hoàn thành (`done`) / tổng số task được giao trong kỳ. | Hiển thị dạng `tasksDone / totalTasks`. |
| **Run Success** | Tỷ lệ phiên chạy (`heartbeat run`) kết thúc thành công, không bị lỗi/crash/timeout/hủy. | `runsSucceeded / (runsSucceeded + runsFailed + runsCancelled) × 100%`. Hiển thị kèm `số run thành công / tổng run kết thúc`. |
| **Reopen Rate** | Tỷ lệ task đã từng `done` nhưng bị mở lại để làm lại (rework). **Càng thấp càng tốt (`0.0%` là lý tưởng).** | `reopenCount / (tasksDone + reopenCount) × 100%`. Tính từ lịch sử chuyển trạng thái `done → mở lại` trong `activity_log`. |
| **Avg Cycle** | Thời gian xử lý trung bình gồm 2 dòng:<br>• **Dòng trên (`🕒`)**: **Avg Cycle Time** — thời gian trung bình hoàn thành 1 task `done` (`completedAt − startedAt`).<br>• **Dòng dưới (`run`)**: **Avg Run Duration** — thời lượng trung bình của 1 phiên chạy AI (`finishedAt − startedAt`). | Xem giải thích chi tiết cách đọc 2 số ở [Mục 4](#4-cách-đọc-2-số-trong-cột-avg-cycle-và-runs--task). |
| **Cache Hit** | Tỷ lệ token đầu vào được tái sử dụng từ prompt cache của LLM. **Càng cao càng tiết kiệm chi phí và nhanh hơn.** | `cachedInputTokens / (inputTokens + cachedInputTokens) × 100%`. |
| **Cost / Task** | • **Dòng trên**: Chi phí API trung bình để hoàn thành 1 task `done`.<br>• **Dòng dưới (`total`)**: Tổng chi phí API của agent trong kỳ. | `totalCostUsd / tasksDone` (dùng `cacheAdjustedCostUsd` nếu có, ngược lại dùng `costUsd`). |
| **Runs / Task** | Số phiên chạy (`heartbeat run`) trung bình cần để hoàn thành 1 task `done`. | `runsOnDoneTasks / doneTasksWithRuns`. Càng gần `1.0` càng gọn. |
| **Board Rating** | • **Dòng trên (`★`)**: Số sao trung bình (1–5★) từ các đánh giá của bạn cho agent đó trong kỳ.<br>• **Dòng dưới**: Số task đạt `Pass` / tổng số task đã được chấm (`passCount / reviewCount`). | Hiển thị `—` nếu agent chưa có task nào được chấm điểm trong kỳ. |

---

## 3. Công thức tính `Score` (0–100)

$$\text{Score} = \text{round}\left(\frac{0.45 \times \text{RunSuccess} + 0.25 \times (100 - \text{ReopenRate}) + 0.30 \times \left(\frac{\text{BoardRating}}{5} \times 100\right)}{\text{Tổng trọng số của các chỉ số có dữ liệu}}\right)$$

### Quy tắc xử lý thiếu dữ liệu
- Nếu agent **chưa có bất kỳ dữ liệu nào** (`tasksDone = 0`, `totalRuns = 0`, chưa có `Board Rating`) → hiển thị `—`.
- Nếu thiếu 1 thành phần (ví dụ **chưa có `Board Rating`**), hệ thống **không tính 0 điểm** mà tự bỏ thành phần đó và chia lại theo tổng trọng số các phần còn lại (`0.45 + 0.25 = 0.70`).

### Ví dụ tính thực tế
1. **Agent có đủ 3 chỉ số** (`Run Success = 76.7%`, `Reopen Rate = 16.7%`, `Board Rating = 4.0★`):
   - `76.7 × 0.45 = 34.515`
   - `(100 − 16.7) × 0.25 = 20.825`
   - `(4.0 / 5 × 100) × 0.30 = 24.0`
   - `Score = round((34.515 + 20.825 + 24.0) / 1.00) = 79`.
2. **Agent chưa có `Board Rating`** (`Run Success = 89.3%`, `Reopen Rate = 0.0%`):
   - `89.3 × 0.45 = 40.185`
   - `100 × 0.25 = 25.0`
   - `Score = round((40.185 + 25.0) / 0.70) = 93`.

### Quy ước màu hiển thị
- **Xanh lá (`≥ 80`)**: Hiệu suất tốt.
- **Vàng (`60 – 79`)**: Hiệu suất trung bình, cần theo dõi thêm.
- **Đỏ (`< 60`)**: Hiệu suất thấp, cần kiểm tra nguyên nhân lỗi/rework.

---

## 4. Cách đọc 2 số trong cột `Avg Cycle` và `Runs / Task`

### Tại sao 1 task có nhiều `runs`?
Trong Paperclip, mỗi **run (`heartbeat run`)** là **1 lần agent được đánh thức dậy để làm việc** rồi ngủ lại. Một task có thể cần nhiều runs khi:
- Agent quản lý (CEO, PM) cần nhiều nhịp: chia subtask → chờ team làm → kiểm tra & đóng task.
- Có thêm comment mới hoặc bị `Reopen` để sửa lại.
- Phiên chạy trước bị lỗi/timeout nên hệ thống đánh thức phiên kế tiếp làm nốt.

### Tại sao `Avg Cycle` (số trên) có lúc lớn hơn, có lúc nhỏ hơn `run` (số dưới)?
- **Số trên > số dưới** *(VD: `25.5m` vs `run 4.5m`)*: Phổ biến nhất. Mỗi lần agent chạy chỉ mất `4.5m`, nhưng task cần nhiều nhịp hoặc phải chờ các subtask con của team hoàn thành mới đóng `done` được.
- **Số trên < số dưới** *(VD: `4.1m` vs `run 8.0m`)*: Vì **số trên chỉ tính trên các task đã `done`**, còn **số dưới tính trung bình trên tất cả các phiên chạy trong kỳ** (kể cả phiên chạy lâu của task chưa xong hoặc phiên bị timeout trước đó).

---

## 5. Quy tắc chấm điểm `Board Quality Review` & Luồng `Rework`

### Chấm theo đúng người phụ trách (`assignee`)
- Mỗi issue (cả task cha lẫn subtask con) khi ở trạng thái `done` hoặc `in_review` đều có khung **Board Quality Review** riêng (có nút `Hide` / `Rate` / `Edit` để thu gọn).
- Đánh giá trên issue nào sẽ được tính điểm cho **đúng agent đang là `assignee` của issue đó**:
  - Chấm trên task cha → tính cho agent phụ trách task cha (thường là CEO).
  - Chấm trên subtask → tính cho agent phụ trách subtask đó (PM, UI/UX, Full-Stack, QA, DevOps...).
- Không bắt buộc phải chấm mọi subtask; các task không chấm sẽ không ảnh hưởng điểm trung bình.

### Ghi đè trên cùng 1 issue vs Trung bình nhiều issue
- **Trong cùng 1 issue**: mỗi issue chỉ lưu **1 đánh giá mới nhất** (`upsert` theo `issueId`). Khi bạn đổi từ `4★ · Needs Rework` sang `5★ · Pass` sau khi agent sửa xong, điểm của issue đó được cập nhật thành `5★ · Pass` (tránh phạt kép vì `Reopen Rate` đã ghi nhận lần mở lại rồi).
- **Trên toàn bảng Performance của 1 agent**: cột `Board Rating` tính **trung bình cộng của tất cả các issue đã được chấm** của agent đó trong kỳ lọc.

### Luồng tự động khi chọn `Needs Rework` + `Reopen task to Todo for rework`
Khi issue đang ở trạng thái `done` và bạn chọn **`Needs Rework`** + tích **`Reopen task to Todo for rework`** + bấm **`Save Review`**, hệ thống tự động thực hiện 3 bước:
1. Lưu đánh giá (`rating`, `verdict = needs_rework`, `note`) và chuyển issue từ `done` → `todo` (ghi nhận vào `Reopen Rate`).
2. Tự động đăng một comment **`Board Quality Review`** vào luồng issue chứa số sao và nội dung ghi chú để agent biết chính xác cần sửa gì.
3. Tự động đánh thức agent phụ trách (`queueIssueAssignmentWakeup`, `reason: "quality_review_rework"`) dậy xử lý ngay.

### Phân biệt **Rework** và **Nâng cấp (Enhancement)** để không làm sai KPI

| Tình huống | Nên làm gì? | Ảnh hưởng KPI |
|---|---|---|
| **Rework (Sửa lỗi / làm thiếu yêu cầu cũ)** | Bấm **`Needs Rework` + `Reopen`** ngay trên issue đó. | Tăng `Reopen Rate`, phản ánh đúng lỗi chất lượng. |
| **Nâng cấp (Thêm tính năng mới ngoài yêu cầu ban đầu)** | Giữ issue cũ là **`Done` + `Pass`**, tạo một **issue mới** cho phần nâng cấp (tham chiếu issue cũ). | Không làm tăng oan `Reopen Rate` hay tụt điểm của agent. |

---

## 6. Danh sách file mã nguồn liên quan

- **Database Schema**: [`packages/db/src/schema/issue_quality_reviews.ts`](../packages/db/src/schema/issue_quality_reviews.ts)
- **Shared Types & Validators**: [`packages/shared/src/validators/performance.ts`](../packages/shared/src/validators/performance.ts)
- **Backend Service (tính toán chỉ số & luồng Rework)**: [`server/src/services/performance.ts`](../server/src/services/performance.ts)
- **Backend Routes**: [`server/src/routes/performance.ts`](../server/src/routes/performance.ts)
- **UI Trang Performance**: [`ui/src/pages/Performance/PerformancePage.tsx`](../ui/src/pages/Performance/PerformancePage.tsx)
- **UI Khung chấm điểm trên Issue**: [`ui/src/components/IssueQualityReviewCard.tsx`](../ui/src/components/IssueQualityReviewCard.tsx)

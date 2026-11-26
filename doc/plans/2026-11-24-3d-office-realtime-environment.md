# Thiết kế Chi tiết: Môi trường Thời gian Thực (Realtime Environment)

> Tài liệu bổ sung cho [2026-11-24-native-3d-office.md](file:///c:/Users/OS/Desktop/paperclip/doc/plans/2026-11-24-native-3d-office.md).
> Mục tiêu: Đồng bộ ánh sáng, bầu trời và thời tiết của văn phòng 3D theo thời gian thực trong ngày, giúp không gian có chiều sâu và phản ánh nhịp làm việc sáng/tối.

---

## 1. Các Tính năng

1. **Chu kỳ Ngày / Đêm theo Thời gian Thực (Day/Night Cycle):**
   * Đọc **giờ local của trình duyệt** (`new Date()`), cập nhật mỗi 60 giây (mượt theo frame khi người dùng kéo thanh trượt).
   * Schema `companies` hiện **chưa có trường timezone**, vì vậy mỗi người xem thấy trời theo múi giờ của chính máy mình. Nếu sau này công ty có timezone, có thể thêm tùy chọn "Theo giờ công ty".
   * 4 pha ánh sáng (mốc cố định, không tính theo mùa/vĩ độ trong V1):
     * **Bình minh (05:30 – 07:30):** Nắng sớm cam hồng, góc chiếu thấp, bóng đổ dài.
     * **Ban ngày (07:30 – 17:00):** Mặt trời đi theo vòng cung Đông → Tây, trời xanh sáng.
     * **Hoàng hôn (17:00 – 18:30):** Ánh sáng vàng cam, bầu trời chuyển tím hồng.
     * **Ban đêm (18:30 – 05:30):** Trời xanh thẫm có sao/trăng, ánh sáng môi trường hạ thấp.
2. **Tự động Bật Đèn & Màn hình Ban đêm (Auto Night Lighting):**
   * Khi `isNight`, đèn trần, đèn bàn và **màn hình của agent đang `coding`/`thinking`** sáng lên; agent `idle`/`paused` để màn hình tối.
   * Server Rack nổi bật đèn LED; Lounge dùng tông đèn ấm.
3. **Bộ điều khiển Thời gian (Time Override):**
   * `Auto (Realtime)` (mặc định) hoặc preset `Sáng / Hoàng hôn / Đêm`, hoặc thanh trượt `0h – 24h`.
   * Lưu như **tùy chọn cá nhân của người xem**, không ảnh hưởng người khác.
4. **Thời tiết ngoài Cửa kính (Weather Particles + Audio):**
   * `Clear` (mặc định), `Rain`, `Snow` — **chỉ chọn thủ công**. Không gọi API thời tiết bên ngoài và không xin quyền vị trí (tránh gọi mạng ra ngoài và vấn đề quyền riêng tư).
   * Khi `Rain`, Spatial Audio phát tiếng mưa khi người chơi đứng gần vách kính (chỉ khi âm thanh đã được bật).
5. **Tổng kết Cuối ngày lúc Hoàng hôn (End-of-day Recap):**
   * Khi giờ thực đi qua **18:00** (chỉ ở chế độ `realtime`, mỗi ngày 1 lần), hiện một thẻ HUD có thể đóng: số issue hoàn thành, số run lỗi, tổng chi phí trong ngày, approval còn chờ.
   * Có tùy chọn tắt; không phát âm thanh nếu đang mute.

---

## 2. Hướng Triển khai Kỹ thuật (Tối ưu 60 FPS)

1. **Hàm thuần `computeLighting(hour)`:**
   * Nhận giờ thập phân (0.0–24.0), trả về `ComputedLightingState`. Không phụ thuộc Three.js → unit test trực tiếp bằng Vitest (kiểm tra 4 pha, các mốc biên 5.5 / 7.5 / 17 / 18.5, và tính liên tục khi qua 0h).
2. **Chỉ 1 `DirectionalLight` đổ bóng:**
   * Mặt trời/Mặt trăng dùng chung một nguồn sáng, góc `sunAngle = ((hour - 6) / 24) * 2π` (6h mọc, 12h đỉnh, 18h lặn); ban đêm đổi màu/cường độ thành ánh trăng.
3. **Vật liệu `emissive` cho đèn bàn & màn hình:**
   * Không tạo `PointLight` cho từng bàn; tăng `emissiveIntensity` trên `MeshStandardMaterial` khi `isNight`.
4. **Nội suy màu mượt (Color Lerp):**
   * Keyframe màu cho bầu trời, `fog` và `AmbientLight` tại `0h, 5.5h, 7.5h, 12h, 17h, 18.5h, 21h`, nội suy bằng `THREE.Color.lerp()`.
   * **Màu keyframe là tên token** (ví dụ `--office-sky-day`) khai báo trong `ui/src/index.css`, đọc lúc chạy bằng `getComputedStyle` → không vi phạm `pnpm check:token-gates` và có thể chỉnh theo theme.
5. **Weather System gọn nhẹ:**
   * 1 `BufferGeometry` với ~400–600 hạt `THREE.Points` quanh tòa nhà, cập nhật trong `useFrame`, reset khi chạm đất.
   * Tắt hoàn toàn trong Performance mode hoặc khi `prefers-reduced-motion`.
6. **Âm thanh:** `AudioContext` chỉ khởi tạo sau thao tác đầu tiên của người dùng; mặc định tắt tiếng.

---

## 3. Các Interface Đề xuất

```typescript
export type EnvironmentTimeMode = "realtime" | "day" | "sunset" | "night" | "custom";

export type WeatherKind = "clear" | "rain" | "snow";

export type DayPhase = "dawn" | "day" | "sunset" | "night";

/** Tùy chọn cá nhân của người xem (không phải dữ liệu công ty). */
export interface EnvironmentConfig {
  timeMode: EnvironmentTimeMode;
  /** Giờ thủ công (0.0 - 24.0) khi timeMode === "custom" */
  customHour: number;
  weather: WeatherKind;
  enableNightAutoLights: boolean;
  enableEndOfDayRecap: boolean;
  weatherAudioVolume: number; // 0.0 - 1.0
}

/** Tên CSS variable trong ui/src/index.css, ví dụ "--office-sky-day". */
export type OfficeColorToken = `--office-${string}`;

export interface ComputedLightingState {
  effectiveHour: number; // 0.0 - 24.0
  phase: DayPhase;
  isNight: boolean;
  sunPosition: [number, number, number];
  sunColor: OfficeColorToken;
  sunIntensity: number;
  ambientColor: OfficeColorToken;
  ambientIntensity: number;
  skyTopColor: OfficeColorToken;
  skyHorizonColor: OfficeColorToken;
  fogColor: OfficeColorToken;
  /** Hệ số nội suy giữa 2 keyframe màu kề nhau (0.0 - 1.0) */
  blend: number;
  screenEmissiveIntensity: number;
  ceilingLampEmissiveIntensity: number;
}

export type ComputeLighting = (hour: number) => ComputedLightingState;

export interface EndOfDayRecap {
  date: string; // YYYY-MM-DD theo giờ local
  issuesCompleted: number;
  runsFailed: number;
  totalCostCents: number;
  pendingApprovals: number;
}
```

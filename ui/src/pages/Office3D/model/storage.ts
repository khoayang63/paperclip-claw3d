import {
  agentSkinsStorageKey,
  arcadeHighScoreStorageKey,
  DEFAULT_ENVIRONMENT_CONFIG,
  DEFAULT_PLAYER_SKIN,
  environmentStorageKey,
  hotbarStorageKey,
  minimapVisibilityStorageKey,
  officeLayoutStorageKey,
  performanceModeStorageKey,
  playerSkinStorageKey,
  playerStateStorageKey,
  recapDismissedStorageKey,
} from "./constants";
import { createEmptyHotbar, sanitizeHotbarState } from "./hotbar";
import { validateAndSanitizeLayout } from "./layout";
import type {
  AgentSkinMap,
  AvatarSkinConfig,
  EnvironmentConfig,
  OfficeHotbarState,
  OfficeLayout,
  SavedOfficePlayerState,
} from "./types";

function safeGetItem(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota or private-mode exceptions gracefully
  }
}

export function loadOfficeLayout(
  companyId: string,
  activeAgentIds: ReadonlySet<string>,
): { layout: OfficeLayout; repaired: boolean } | null {
  const raw = safeGetItem(officeLayoutStorageKey(companyId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateAndSanitizeLayout(parsed, companyId, activeAgentIds);
  } catch {
    return null;
  }
}

export function saveOfficeLayout(layout: OfficeLayout): void {
  safeSetItem(officeLayoutStorageKey(layout.companyId), JSON.stringify(layout));
}

export function loadPlayerSkin(): AvatarSkinConfig {
  const raw = safeGetItem(playerSkinStorageKey());
  if (!raw) return DEFAULT_PLAYER_SKIN;
  try {
    const parsed = JSON.parse(raw) as Partial<AvatarSkinConfig>;
    return {
      outfit: parsed.outfit ?? DEFAULT_PLAYER_SKIN.outfit,
      headwear: parsed.headwear ?? DEFAULT_PLAYER_SKIN.headwear,
      skinTone: parsed.skinTone ?? DEFAULT_PLAYER_SKIN.skinTone,
      hairColor: parsed.hairColor ?? DEFAULT_PLAYER_SKIN.hairColor,
    };
  } catch {
    return DEFAULT_PLAYER_SKIN;
  }
}

export function savePlayerSkin(skin: AvatarSkinConfig): void {
  safeSetItem(playerSkinStorageKey(), JSON.stringify(skin));
}

export function loadAgentSkins(companyId: string): AgentSkinMap {
  const raw = safeGetItem(agentSkinsStorageKey(companyId));
  if (!raw) return { companyId, skins: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<AgentSkinMap>;
    if (!parsed || typeof parsed.skins !== "object" || !parsed.skins) {
      return { companyId, skins: {} };
    }
    return { companyId, skins: parsed.skins };
  } catch {
    return { companyId, skins: {} };
  }
}

export function saveAgentSkins(map: AgentSkinMap): void {
  safeSetItem(agentSkinsStorageKey(map.companyId), JSON.stringify(map));
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const raw = safeGetItem(environmentStorageKey());
  if (!raw) return DEFAULT_ENVIRONMENT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<EnvironmentConfig>;
    return {
      timeMode: parsed.timeMode ?? DEFAULT_ENVIRONMENT_CONFIG.timeMode,
      customHour:
        typeof parsed.customHour === "number" && Number.isFinite(parsed.customHour)
          ? Math.max(0, Math.min(24, parsed.customHour))
          : DEFAULT_ENVIRONMENT_CONFIG.customHour,
      weather: parsed.weather ?? DEFAULT_ENVIRONMENT_CONFIG.weather,
      enableNightAutoLights:
        typeof parsed.enableNightAutoLights === "boolean"
          ? parsed.enableNightAutoLights
          : DEFAULT_ENVIRONMENT_CONFIG.enableNightAutoLights,
      enableEndOfDayRecap:
        typeof parsed.enableEndOfDayRecap === "boolean"
          ? parsed.enableEndOfDayRecap
          : DEFAULT_ENVIRONMENT_CONFIG.enableEndOfDayRecap,
      weatherAudioVolume:
        typeof parsed.weatherAudioVolume === "number" && Number.isFinite(parsed.weatherAudioVolume)
          ? Math.max(0, Math.min(1, parsed.weatherAudioVolume))
          : DEFAULT_ENVIRONMENT_CONFIG.weatherAudioVolume,
    };
  } catch {
    return DEFAULT_ENVIRONMENT_CONFIG;
  }
}

export function saveEnvironmentConfig(config: EnvironmentConfig): void {
  safeSetItem(environmentStorageKey(), JSON.stringify(config));
}

export function loadPerformanceMode(): boolean {
  return safeGetItem(performanceModeStorageKey()) === "true";
}

export function savePerformanceMode(enabled: boolean): void {
  safeSetItem(performanceModeStorageKey(), enabled ? "true" : "false");
}

export function isRecapDismissedForDate(companyId: string, dateStr: string): boolean {
  return safeGetItem(recapDismissedStorageKey(companyId, dateStr)) === "1";
}

export function dismissRecapForDate(companyId: string, dateStr: string): void {
  safeSetItem(recapDismissedStorageKey(companyId, dateStr), "1");
}

export function loadOfficeHotbar(companyId: string): OfficeHotbarState {
  if (!companyId) return createEmptyHotbar();
  const raw = safeGetItem(hotbarStorageKey(companyId));
  if (!raw) return createEmptyHotbar();
  try {
    return sanitizeHotbarState(JSON.parse(raw));
  } catch {
    return createEmptyHotbar();
  }
}

export function saveOfficeHotbar(companyId: string, state: OfficeHotbarState): void {
  if (!companyId) return;
  safeSetItem(hotbarStorageKey(companyId), JSON.stringify(state));
}

export function loadShowMinimap(companyId: string): boolean {
  if (!companyId) return true;
  const raw = safeGetItem(minimapVisibilityStorageKey(companyId));
  if (raw === null) return true;
  return raw !== "false";
}

export function saveShowMinimap(companyId: string, show: boolean): void {
  if (!companyId) return;
  safeSetItem(minimapVisibilityStorageKey(companyId), show ? "true" : "false");
}

export function loadOfficePlayerState(companyId: string): SavedOfficePlayerState | null {
  if (!companyId) return null;
  const raw = safeGetItem(playerStateStorageKey(companyId));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SavedOfficePlayerState>;
    if (
      !p ||
      typeof p.buildingId !== "string" ||
      typeof p.floorId !== "string" ||
      typeof p.x !== "number" ||
      typeof p.z !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.z)
    ) {
      return null;
    }
    const validCam =
      p.cameraMode === "rpg" || p.cameraMode === "first_person" || p.cameraMode === "overview"
        ? p.cameraMode
        : "rpg";
    const validView = p.buildingViewMode === "full" ? "full" : "cutaway";
    return {
      buildingId: p.buildingId,
      floorId: p.floorId,
      x: p.x,
      z: p.z,
      yaw: typeof p.yaw === "number" && Number.isFinite(p.yaw) ? p.yaw : 0,
      ...(typeof p.fpYaw === "number" && Number.isFinite(p.fpYaw) ? { fpYaw: p.fpYaw } : {}),
      ...(typeof p.fpPitch === "number" && Number.isFinite(p.fpPitch) ? { fpPitch: p.fpPitch } : {}),
      cameraMode: validCam,
      buildingViewMode: validView,
    };
  } catch {
    return null;
  }
}

export function saveOfficePlayerState(companyId: string, state: SavedOfficePlayerState): void {
  if (!companyId) return;
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z)) return;
  safeSetItem(playerStateStorageKey(companyId), JSON.stringify(state));
}

export function loadArcadeHighScore(companyId: string): number {
  if (!companyId) return 0;
  const raw = safeGetItem(arcadeHighScoreStorageKey(companyId));
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function saveArcadeHighScore(companyId: string, score: number): void {
  if (!companyId || !Number.isFinite(score) || score < 0) return;
  safeSetItem(arcadeHighScoreStorageKey(companyId), String(Math.floor(score)));
}

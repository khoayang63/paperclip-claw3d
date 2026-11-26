import {
  AVATAR_HAIR_COLORS,
  AVATAR_HEADWEAR,
  AVATAR_OUTFITS,
  AVATAR_SKIN_TONES,
  RUN_ERROR_RECENCY_MS,
} from "./constants";
import type {
  AgentVisualState,
  AgentVisualStateInput,
  AvatarHairColor,
  AvatarHeadwear,
  AvatarOutfit,
  AvatarSkinConfig,
  MapAgentVisualState,
} from "./types";

/**
 * Maps live Paperclip agent + heartbeat run signals to a deterministic 3D visual state.
 * Priority follows doc/plans/2026-11-24-3d-office-control-plane.md §2.
 */
export const mapAgentVisualState: MapAgentVisualState = (
  input: AgentVisualStateInput,
): AgentVisualState => {
  if (input.agentStatus === "terminated") return "hidden";
  if (input.agentStatus === "pending_approval") return "awaiting_hire";
  if (input.agentStatus === "paused") {
    return input.pauseReason === "budget" ? "paused_budget" : "paused";
  }

  const recentRunFailure =
    input.lastRunFailedAt !== null &&
    Number.isFinite(Date.parse(input.lastRunFailedAt)) &&
    input.now - Date.parse(input.lastRunFailedAt) <= RUN_ERROR_RECENCY_MS &&
    input.currentRunStatus !== "running" &&
    input.currentRunStatus !== "queued" &&
    input.currentRunStatus !== "scheduled_retry" &&
    input.currentRunStatus !== "succeeded";

  if (input.agentStatus === "error" || recentRunFailure) {
    return "error";
  }

  if (input.currentRunStatus === "running") {
    return input.lastRunEventKind === "tool_call" ? "coding" : "thinking";
  }

  if (input.currentRunStatus === "queued" || input.currentRunStatus === "scheduled_retry") {
    return "waiting";
  }

  if (input.inMeeting) {
    return "meeting";
  }

  return "idle";
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Generates a deterministic default Voxel avatar skin from an agent's role & ID
 * when the user has not explicitly customized that agent's appearance.
 */
export function deriveDefaultAgentSkin(
  agentId: string,
  role: string,
  _icon?: string | null,
): AvatarSkinConfig {
  const seed = hashString(agentId);
  const roleLower = role.toLowerCase();

  let outfit: AvatarOutfit = AVATAR_OUTFITS[seed % AVATAR_OUTFITS.length]!;
  let headwear: AvatarHeadwear = AVATAR_HEADWEAR[(seed >>> 3) % AVATAR_HEADWEAR.length]!;

  if (roleLower.includes("ceo") || roleLower.includes("exec") || roleLower.includes("lead")) {
    outfit = "suit";
    headwear = "glasses";
  } else if (roleLower.includes("qa") || roleLower.includes("test") || roleLower.includes("security")) {
    outfit = "shirt";
    headwear = "hardhat";
  } else if (roleLower.includes("eng") || roleLower.includes("dev") || roleLower.includes("coder")) {
    outfit = "hoodie";
    headwear = "headset";
  } else if (roleLower.includes("pm") || roleLower.includes("product") || roleLower.includes("analyst")) {
    outfit = "shirt";
    headwear = seed % 2 === 0 ? "glasses" : "sunglasses";
  } else if (roleLower.includes("design") || roleLower.includes("research")) {
    outfit = "tshirt";
    headwear = "beanie";
  }

  const skinTone = AVATAR_SKIN_TONES[(seed >>> 6) % AVATAR_SKIN_TONES.length]!;
  const hairColor: AvatarHairColor = AVATAR_HAIR_COLORS[(seed >>> 9) % AVATAR_HAIR_COLORS.length]!;

  return { outfit, headwear, skinTone, hairColor };
}

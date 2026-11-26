import { HOTBAR_SLOT_COUNT } from "./constants";
import type { HotbarItem, OfficeHotbarState } from "./types";

export function createEmptyHotbar(slotCount = HOTBAR_SLOT_COUNT): OfficeHotbarState {
  return {
    selectedSlot: 0,
    slots: Array.from({ length: slotCount }, () => null),
  };
}

export function sanitizeHotbarState(raw: unknown): OfficeHotbarState {
  const base = createEmptyHotbar();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Partial<OfficeHotbarState>;
  const rawSlots = Array.isArray(record.slots) ? record.slots : [];
  for (let i = 0; i < HOTBAR_SLOT_COUNT; i++) {
    const candidate = rawSlots[i];
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.id === "string" &&
      typeof candidate.kind === "string" &&
      typeof candidate.label === "string" &&
      ["water_cup", "coffee_cup", "document", "handbook"].includes(candidate.kind)
    ) {
      base.slots[i] = {
        id: candidate.id,
        kind: candidate.kind,
        label: candidate.label,
        ...(typeof candidate.sourceStationId === "string"
          ? { sourceStationId: candidate.sourceStationId }
          : {}),
        ...(candidate.entityKind === "issue" || candidate.entityKind === "agent"
          ? { entityKind: candidate.entityKind }
          : {}),
        ...(typeof candidate.entityId === "string" ? { entityId: candidate.entityId } : {}),
        ...(typeof candidate.entityIdentifier === "string"
          ? { entityIdentifier: candidate.entityIdentifier }
          : {}),
      };
    }
  }
  const sel = typeof record.selectedSlot === "number" ? Math.floor(record.selectedSlot) : 0;
  base.selectedSlot = Math.max(0, Math.min(HOTBAR_SLOT_COUNT - 1, sel));
  return base;
}

export function selectHotbarSlot(state: OfficeHotbarState, index: number): OfficeHotbarState {
  const clamped = Math.max(0, Math.min(state.slots.length - 1, Math.floor(index)));
  return {
    ...state,
    selectedSlot: clamped,
  };
}

export function getSelectedHotbarItem(state: OfficeHotbarState): HotbarItem | null {
  return state.slots[state.selectedSlot] ?? null;
}

/**
 * Adds an item to the currently selected slot if empty, otherwise the first open slot.
 */
export function addItemToHotbar(
  state: OfficeHotbarState,
  item: HotbarItem,
): { next: OfficeHotbarState; addedSlot: number | null; full: boolean } {
  const slots = [...state.slots];
  const targetIndex =
    slots[state.selectedSlot] === null
      ? state.selectedSlot
      : slots.findIndex((slot) => slot === null);

  if (targetIndex < 0) {
    return { next: state, addedSlot: null, full: true };
  }

  slots[targetIndex] = item;
  return {
    next: {
      selectedSlot: targetIndex,
      slots,
    },
    addedSlot: targetIndex,
    full: false,
  };
}

export function removeHotbarSlot(state: OfficeHotbarState, index: number): OfficeHotbarState {
  if (index < 0 || index >= state.slots.length) return state;
  const slots = [...state.slots];
  slots[index] = null;
  return {
    ...state,
    slots,
  };
}

/**
 * Swaps two hotbar slots (either filled↔filled or filled↔empty) and selects `toIndex`.
 */
export function swapHotbarSlots(
  state: OfficeHotbarState,
  fromIndex: number,
  toIndex: number,
): OfficeHotbarState {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.slots.length ||
    toIndex >= state.slots.length
  ) {
    return state;
  }
  const slots = [...state.slots];
  const fromItem = slots[fromIndex] ?? null;
  const toItem = slots[toIndex] ?? null;
  slots[fromIndex] = toItem;
  slots[toIndex] = fromItem;
  return {
    selectedSlot: toIndex,
    slots,
  };
}

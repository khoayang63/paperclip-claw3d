import { describe, expect, it } from "vitest";
import { HOTBAR_SLOT_COUNT } from "./constants";
import {
  addItemToHotbar,
  createEmptyHotbar,
  getSelectedHotbarItem,
  removeHotbarSlot,
  sanitizeHotbarState,
  selectHotbarSlot,
  swapHotbarSlots,
} from "./hotbar";

describe("hotbar", () => {
  it("adds items into selected empty slot first, then first open slot, and reports full when all 6 are occupied", () => {
    let state = selectHotbarSlot(createEmptyHotbar(), 2);
    const first = addItemToHotbar(state, { id: "i1", kind: "water_cup", label: "Water Cup" });
    expect(first.full).toBe(false);
    expect(first.addedSlot).toBe(2);
    expect(getSelectedHotbarItem(first.next)?.kind).toBe("water_cup");
    state = first.next;

    for (let idx = 0; idx < HOTBAR_SLOT_COUNT - 1; idx++) {
      const res = addItemToHotbar(state, {
        id: `extra-${idx}`,
        kind: "coffee_cup",
        label: "Coffee Cup",
      });
      expect(res.full).toBe(false);
      state = res.next;
    }

    const overflow = addItemToHotbar(state, { id: "over", kind: "document", label: "Document" });
    expect(overflow.full).toBe(true);
    expect(overflow.addedSlot).toBeNull();
  });

  it("removes items from slot and sanitizes persisted hotbar payloads safely", () => {
    const start = addItemToHotbar(createEmptyHotbar(), {
      id: "doc-1",
      kind: "document",
      label: "Sprint Report",
    }).next;
    const dropped = removeHotbarSlot(start, 0);
    expect(getSelectedHotbarItem(dropped)).toBeNull();

    const restored = sanitizeHotbarState({
      selectedSlot: 99,
      slots: [
        { id: "ok", kind: "handbook", label: "Handbook" },
        { id: "bad", kind: "invalid_item", label: "Nope" },
        {
          id: "iss",
          kind: "document",
          label: "PTI-12",
          entityKind: "issue",
          entityId: "issue-uuid-12",
          entityIdentifier: "PTI-12",
        },
      ],
    });
    expect(restored.selectedSlot).toBe(HOTBAR_SLOT_COUNT - 1);
    expect(restored.slots).toHaveLength(HOTBAR_SLOT_COUNT);
    expect(restored.slots[0]?.kind).toBe("handbook");
    expect(restored.slots[1]).toBeNull();
    expect(restored.slots[2]).toEqual({
      id: "iss",
      kind: "document",
      label: "PTI-12",
      entityKind: "issue",
      entityId: "issue-uuid-12",
      entityIdentifier: "PTI-12",
    });
  });

  it("swaps two slots safely between filled/filled and filled/empty positions", () => {
    let state = addItemToHotbar(createEmptyHotbar(), {
      id: "c1",
      kind: "coffee_cup",
      label: "Coffee Cup",
    }).next;
    state = addItemToHotbar(state, {
      id: "w1",
      kind: "water_cup",
      label: "Water Cup",
    }).next;

    // Move water_cup (slot 1) into empty slot 4
    state = swapHotbarSlots(state, 1, 4);
    expect(state.slots[1]).toBeNull();
    expect(state.slots[4]?.id).toBe("w1");
    expect(state.selectedSlot).toBe(4);

    // Swap coffee_cup (slot 0) with water_cup (slot 4)
    state = swapHotbarSlots(state, 0, 4);
    expect(state.slots[0]?.id).toBe("w1");
    expect(state.slots[4]?.id).toBe("c1");
    expect(state.selectedSlot).toBe(4);

    // Out-of-bounds or same-slot swaps are no-ops
    expect(swapHotbarSlots(state, 2, 2)).toBe(state);
    expect(swapHotbarSlots(state, -1, 2)).toBe(state);
  });
});

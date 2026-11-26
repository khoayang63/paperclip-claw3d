import { describe, expect, it } from "vitest";
import { buildOutdoorLife } from "./outdoorLife";
import { OfficePalette } from "./palette";

describe("outdoorLife", () => {
  const palette = new OfficePalette();

  it("builds animated animals, koi pond fish, birds, butterflies, and fountain spray outdoors", () => {
    const handle = buildOutdoorLife({
      gridW: 30,
      gridD: 30,
      groundY: -0.32,
      palette,
    });

    expect(handle.root.children.length).toBeGreaterThanOrEqual(40);

    // Run simulation steps across clear and rainy weather
    handle.update(0.016, 1.0, "clear", false);
    handle.update(0.016, 2.5, "rain", false);

    for (const child of handle.root.children) {
      expect(Number.isFinite(child.position.x)).toBe(true);
      expect(Number.isFinite(child.position.y)).toBe(true);
      expect(Number.isFinite(child.position.z)).toBe(true);

      // No outdoor creature or fountain droplet should enter the ground-floor building interior
      const insideBuilding =
        child.position.x > 0 &&
        child.position.x < 30 &&
        child.position.z > 0 &&
        child.position.z < 30;
      expect(insideBuilding).toBe(false);
    }
  });

  it("supports petting dogs (toggle follow), cats, rabbits, feeding Koi fish, and fountain wishes", () => {
    const handle = buildOutdoorLife({
      gridW: 30,
      gridD: 30,
      groundY: -0.32,
      palette,
    });

    expect(handle.getClickableEntries().length).toBeGreaterThanOrEqual(8);

    // Dog 0 starts at gridW / 2 - 7.5 = 7.5, gridD + 3.5 = 33.5
    const nearDog = handle.findNearestInteractable(7.8, 33.6);
    expect(nearDog?.kind).toBe("outdoor_dog");
    expect(nearDog?.following).toBe(false);

    const petFollow = handle.interact(nearDog!.id, { x: 8.2, z: 34.0 });
    expect(petFollow?.feedbackKind).toBe("pet_dog_follow");
    expect(handle.findNearestInteractable(7.8, 33.6)?.following).toBe(true);

    // Update while player is indoors — dog trots/waits outside without entering building
    handle.update(0.2, 4.0, "clear", false, { x: 15, z: 15, isIndoors: true });
    const dogEntry = handle.getClickableEntries().find((e) => e.id === nearDog!.id)!;
    expect(dogEntry.object.position.z).toBeGreaterThanOrEqual(30);

    // Pet again to let dog roam freely
    const petStay = handle.interact(nearDog!.id, { x: dogEntry.object.position.x, z: dogEntry.object.position.z + 0.5 });
    expect(petStay?.feedbackKind).toBe("pet_dog_stay");

    // Koi Pond & Fountain interactions
    const pondRes = handle.interact("outdoor-koi-pond", { x: -4, z: 12 });
    expect(pondRes?.feedbackKind).toBe("feed_koi");
    expect(pondRes?.pose).toBe("feeding");

    const coinRes = handle.interact("outdoor-fountain", { x: 15, z: 38 });
    expect(coinRes?.feedbackKind).toBe("toss_coin");

    // Step daytime clear vs night clear (fireflies & sakura petals stay outside building)
    handle.update(0.05, 5.0, "clear", false, { x: 15, z: 38, isIndoors: false }, false);
    handle.update(0.05, 6.0, "clear", false, { x: 15, z: 38, isIndoors: false }, true);
    for (const child of handle.root.children) {
      const insideBuilding =
        child.position.x > 0 &&
        child.position.x < 30 &&
        child.position.z > 0 &&
        child.position.z < 30;
      expect(insideBuilding).toBe(false);
    }
  });
});

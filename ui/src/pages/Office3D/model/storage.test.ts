// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadArcadeHighScore,
  loadOfficePlayerState,
  saveArcadeHighScore,
  saveOfficePlayerState,
} from "./storage";

describe("Office3D storage helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists and restores company-scoped player position, floor, and camera state", () => {
    expect(loadOfficePlayerState("comp-1")).toBeNull();

    saveOfficePlayerState("comp-1", {
      buildingId: "b-1",
      floorId: "f-2",
      x: 18.25,
      z: 34.5,
      yaw: 1.2,
      fpYaw: 2.1,
      fpPitch: -0.1,
      cameraMode: "first_person",
      buildingViewMode: "full",
    });

    const restored = loadOfficePlayerState("comp-1");
    expect(restored).toEqual({
      buildingId: "b-1",
      floorId: "f-2",
      x: 18.25,
      z: 34.5,
      yaw: 1.2,
      fpYaw: 2.1,
      fpPitch: -0.1,
      cameraMode: "first_person",
      buildingViewMode: "full",
    });
    expect(loadOfficePlayerState("comp-2")).toBeNull();
  });

  it("persists and loads arcade high score safely", () => {
    expect(loadArcadeHighScore("comp-1")).toBe(0);
    saveArcadeHighScore("comp-1", 120);
    expect(loadArcadeHighScore("comp-1")).toBe(120);
  });
});

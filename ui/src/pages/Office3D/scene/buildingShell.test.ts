import { describe, expect, it } from "vitest";
import { computeCutawayVisibility } from "./buildingShell";

describe("computeCutawayVisibility", () => {
  const gridW = 30;
  const gridD = 30;

  it("encloses all four walls and enables interior ceiling during low-elevation interior POV", () => {
    const vis = computeCutawayVisibility({ x: 5, y: 2.2, z: 24 }, gridW, gridD, "cutaway", true);
    expect(vis).toEqual({
      cutNorth: false,
      cutSouth: false,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: true,
      showUpperFloors: false,
      showFullRoof: false,
    });
  });

  it("cuts two camera-facing walls from an elevated cutaway vantage point", () => {
    const vis = computeCutawayVisibility({ x: 24, y: 16, z: 24 }, gridW, gridD, "cutaway", true);
    expect(vis).toEqual({
      cutNorth: false,
      cutSouth: true,
      cutWest: false,
      cutEast: true,
      showInteriorCeiling: false,
      showUpperFloors: false,
      showFullRoof: false,
    });
  });

  it("cuts only the exterior wall between a low outdoor camera and the floor interior", () => {
    const vis = computeCutawayVisibility({ x: 15, y: 2.5, z: 32 }, gridW, gridD, "cutaway", false);
    expect(vis).toEqual({
      cutNorth: false,
      cutSouth: true,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: false,
      showUpperFloors: false,
      showFullRoof: false,
    });
  });

  it("keeps all walls closed and reveals upper floors plus roof in full building mode", () => {
    const vis = computeCutawayVisibility({ x: 24, y: 16, z: 24 }, gridW, gridD, "full", true);
    expect(vis).toEqual({
      cutNorth: false,
      cutSouth: false,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: false,
      showUpperFloors: true,
      showFullRoof: true,
    });
  });

  it("reveals full exterior facade and roof automatically when player walks outside onto ground campus or balcony", () => {
    const visGround = computeCutawayVisibility(
      { x: 15, y: 2.2, z: 34 },
      gridW,
      gridD,
      "cutaway",
      true,
      { x: 15, z: 32 },
    );
    expect(visGround).toEqual({
      cutNorth: false,
      cutSouth: false,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: false,
      showUpperFloors: true,
      showFullRoof: true,
    });
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_SKIN } from "../model/constants";
import { OfficePalette } from "./palette";
import { createVoxelCharacter, updateVoxelPose } from "./voxelCharacter";

describe("voxelCharacter action poses", () => {
  const palette = new OfficePalette();

  it("raises right arm inward to mouth, tilts head back, and angles cup during drinking even with reducedMotion", () => {
    const rig = createVoxelCharacter(DEFAULT_PLAYER_SKIN, palette, {
      name: "DrinkTester",
      isPlayer: true,
    });
    updateVoxelPose(rig, "idle", 1, {
      isWalking: false,
      seated: false,
      reducedMotion: true,
      actionPose: "drinking",
      actionProgress: 0.36,
      hasHeldItem: true,
    });

    expect(rig.rightArm.rotation.x).toBeLessThan(-1.3);
    expect(rig.rightArm.rotation.y).toBeLessThan(-0.3);
    expect(rig.headGroup.rotation.x).toBeLessThan(-0.1);
    expect(rig.heldItemMount.rotation.x).toBeGreaterThan(0.5);
  });

  it("angles both arms inward toward chest and tilts head downward during reading", () => {
    const rig = createVoxelCharacter(DEFAULT_PLAYER_SKIN, palette, {
      name: "ReadTester",
      isPlayer: true,
    });
    updateVoxelPose(rig, "idle", 1, {
      isWalking: false,
      seated: false,
      reducedMotion: false,
      actionPose: "reading",
      actionProgress: 0.4,
      hasHeldItem: true,
    });

    expect(rig.leftArm.rotation.x).toBeLessThan(-0.9);
    expect(rig.rightArm.rotation.x).toBeLessThan(-0.9);
    expect(rig.leftArm.rotation.y).toBeGreaterThan(0.2);
    expect(rig.rightArm.rotation.y).toBeLessThan(-0.2);
    expect(rig.headGroup.rotation.x).toBeGreaterThan(0.2);
    expect(rig.heldItemMount.position.x).toBeLessThan(-0.05);
  });

  it("extends both arms forward for giving, reaches forward for inspecting, and holds carried item upright while walking", () => {
    const rig = createVoxelCharacter(DEFAULT_PLAYER_SKIN, palette, {
      name: "MotionTester",
      isPlayer: true,
    });

    updateVoxelPose(rig, "idle", 1, {
      isWalking: false,
      seated: false,
      reducedMotion: false,
      actionPose: "giving",
      actionProgress: 0.5,
      hasHeldItem: true,
    });
    expect(rig.rightArm.rotation.x).toBeLessThan(-0.9);
    expect(rig.leftArm.rotation.x).toBeLessThan(-0.6);

    updateVoxelPose(rig, "idle", 1, {
      isWalking: false,
      seated: false,
      reducedMotion: false,
      actionPose: "inspecting",
      actionProgress: 0.5,
    });
    expect(rig.bodyPivot.rotation.x).toBeGreaterThan(0.05);
    expect(rig.rightArm.rotation.x).toBeLessThan(-0.7);

    updateVoxelPose(rig, "idle", 1, {
      isWalking: true,
      seated: false,
      reducedMotion: false,
      walkPhase: -Math.PI / 2,
      speedRatio: 1,
      hasHeldItem: true,
    });
    expect(rig.rightArm.rotation.x).toBeLessThan(-0.15);
  });
});

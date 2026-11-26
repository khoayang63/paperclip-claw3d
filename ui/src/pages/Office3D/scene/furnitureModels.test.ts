import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BUILDABLE_FURNITURE_KINDS,
  DESK_FOOTPRINT,
  FURNITURE_FOOTPRINTS,
} from "../model/constants";
import type { OfficeItemKind } from "../model/types";
import {
  buildDeskAssembly,
  buildFurnitureAssembly,
  buildHeldItemMesh,
} from "./furnitureModels";
import { OfficePalette } from "./palette";

function measureHorizontalExtent(root: THREE.Object3D): { width: number; depth: number } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return {
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
  };
}

describe("furnitureModels", () => {
  const palette = new OfficePalette();

  it("builds detailed desk assembly with monitor screen, desk lamp bulb, and optional trophy inside desk footprint", () => {
    const plain = buildDeskAssembly({ palette, hasTrophy: false });
    const withTrophy = buildDeskAssembly({ palette, hasTrophy: true });

    expect(plain.group.children.length).toBeGreaterThan(8);
    expect(plain.monitorScreen).toBeInstanceOf(THREE.Mesh);
    expect(plain.deskLampBulb).toBeInstanceOf(THREE.Mesh);
    expect(withTrophy.group.children.length).toBeGreaterThan(plain.group.children.length);

    const desktopBounds = new THREE.Box3().setFromObject(plain.group.children[0]!);
    expect(desktopBounds.max.x - desktopBounds.min.x).toBeLessThanOrEqual(DESK_FOOTPRINT.width + 0.01);
    expect(desktopBounds.max.z - desktopBounds.min.z).toBeLessThanOrEqual(DESK_FOOTPRINT.depth + 0.01);
  });

  it("builds stylized models for all furniture kinds within their collision footprints", () => {
    const statusColor = new THREE.Color(0x22c55e);
    for (const kind of BUILDABLE_FURNITURE_KINDS) {
      const group = buildFurnitureAssembly({
        kind,
        palette,
        statusColor,
        goalCompletionRatio: 0.9,
      });
      expect(group.children.length).toBeGreaterThanOrEqual(3);

      const extent = measureHorizontalExtent(group);
      const fp = FURNITURE_FOOTPRINTS[kind];
      expect(extent.width).toBeLessThanOrEqual(fp.width + 0.02);
      expect(extent.depth).toBeLessThanOrEqual(fp.depth + 0.02);
    }
  });

  it("builds Kanban whiteboard with a floor-grounded rolling stand inside its footprint", () => {
    const group = buildFurnitureAssembly({
      kind: "whiteboard",
      palette,
      statusColor: new THREE.Color(0x22c55e),
      goalCompletionRatio: 0.5,
    });
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeLessThanOrEqual(0.02);
    expect(box.max.y).toBeGreaterThanOrEqual(1.85);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(FURNITURE_FOOTPRINTS.whiteboard.width + 0.02);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(FURNITURE_FOOTPRINTS.whiteboard.depth + 0.02);
  });

  it("builds 3D held item meshes for every hotbar item kind", () => {
    const kinds: OfficeItemKind[] = ["water_cup", "coffee_cup", "document", "handbook"];
    for (const kind of kinds) {
      const group = buildHeldItemMesh(kind, palette);
      expect(group.children.length).toBeGreaterThan(0);
    }
  });
});

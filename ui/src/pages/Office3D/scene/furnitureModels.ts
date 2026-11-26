import * as THREE from "three";
import type { FurnitureKind, OfficeColorToken, OfficeItemKind } from "../model/types";
import type { OfficePalette } from "./palette";

interface FurnitureSharedMaterials {
  wood: THREE.MeshStandardMaterial;
  deskTop: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  darkAccent: THREE.MeshStandardMaterial;
  printerBody: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  chairSeat: THREE.MeshStandardMaterial;
  sofaCloth: THREE.MeshStandardMaterial;
  cushionAccent: THREE.MeshStandardMaterial;
  pot: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean; rx?: number; ry?: number; rz?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  if (options.rx) mesh.rotation.x = options.rx;
  if (options.ry) mesh.rotation.y = options.ry;
  if (options.rz) mesh.rotation.z = options.rz;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  parent.add(mesh);
  return mesh;
}

function createSharedMaterials(palette: OfficePalette): FurnitureSharedMaterials {
  return {
    wood: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-furniture-accent"),
      roughness: 0.65,
    }),
    deskTop: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-desk-top"),
      roughness: 0.52,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-desk-frame"),
      metalness: 0.5,
      roughness: 0.35,
    }),
    darkAccent: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-accessory-dark"),
      roughness: 0.55,
    }),
    printerBody: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-printer-body"),
      metalness: 0.25,
      roughness: 0.45,
    }),
    white: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-outfit-shirt"),
      roughness: 0.4,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-wall-glass"),
      transparent: true,
      opacity: 0.48,
      roughness: 0.15,
      metalness: 0.1,
    }),
    chairSeat: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-chair-seat"),
      roughness: 0.72,
    }),
    sofaCloth: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-palette-slate"),
      roughness: 0.85,
    }),
    cushionAccent: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-palette-sky"),
      roughness: 0.82,
    }),
    pot: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-plant-pot"),
      roughness: 0.75,
    }),
    leaf: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-plant-leaf"),
      roughness: 0.82,
    }),
  };
}

function createSwivelChair(mats: FurnitureSharedMaterials, scale = 1): THREE.Group {
  const chair = new THREE.Group();
  const s = scale;

  // 5-spoke star base with small casters
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 5) * Math.PI * 2;
    addBox(arm, 0.045 * s, 0.03 * s, 0.2 * s, 0, 0.045 * s, 0.1 * s, mats.metal);
    const caster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.03 * s, 8),
      mats.darkAccent,
    );
    caster.rotation.z = Math.PI / 2;
    caster.position.set(0, 0.025 * s, 0.18 * s);
    arm.add(caster);
    chair.add(arm);
  }

  // Hydraulic cylinder stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03 * s, 0.035 * s, 0.34 * s, 8),
    mats.metal,
  );
  stem.position.y = 0.22 * s;
  chair.add(stem);

  // Padded seat cushion & under-frame
  addBox(chair, 0.42 * s, 0.07 * s, 0.4 * s, 0, 0.41 * s, 0, mats.chairSeat, {
    castShadow: true,
    receiveShadow: true,
  });
  addBox(chair, 0.32 * s, 0.03 * s, 0.3 * s, 0, 0.365 * s, 0, mats.metal);

  // Spine + contoured backrest facing +Z (toward desk) so backrest sits at -Z
  addBox(chair, 0.06 * s, 0.36 * s, 0.04 * s, 0, 0.56 * s, -0.19 * s, mats.metal);
  addBox(chair, 0.38 * s, 0.36 * s, 0.06 * s, 0, 0.68 * s, -0.17 * s, mats.chairSeat, {
    castShadow: true,
  });

  // Left & right armrests
  for (const side of [-1, 1] as const) {
    addBox(chair, 0.04 * s, 0.15 * s, 0.04 * s, side * 0.21 * s, 0.5 * s, 0.02 * s, mats.metal);
    addBox(chair, 0.06 * s, 0.035 * s, 0.26 * s, side * 0.21 * s, 0.58 * s, -0.02 * s, mats.darkAccent);
  }

  return chair;
}

/**
 * Builds a detailed workstation desk (wood tabletop with edge trim, metal C-frame legs,
 * drawer pedestal, ergonomic swivel chair, monitor, keyboard/mouse, coffee mug, articulated
 * desk lamp bulb, and optional golden achievement trophy).
 */
export function buildDeskAssembly(params: {
  palette: OfficePalette;
  hasTrophy: boolean;
}): {
  group: THREE.Group;
  monitorScreen: THREE.Mesh;
  deskLampBulb: THREE.Mesh;
} {
  const { palette, hasTrophy } = params;
  const mats = createSharedMaterials(palette);
  const group = new THREE.Group();

  // Tabletop (1.26 x 0.70) & beveled dark edge trim (1.28 x 0.72 — strictly <= DESK_FOOTPRINT)
  addBox(group, 1.26, 0.06, 0.7, 0, 0.73, 0, mats.deskTop, {
    castShadow: true,
    receiveShadow: true,
  });
  addBox(group, 1.28, 0.025, 0.72, 0, 0.7, 0, mats.metal);

  // C-frame legs + bottom runners + rear modesty beam
  for (const lx of [-0.57, 0.57] as const) {
    addBox(group, 0.055, 0.68, 0.055, lx, 0.35, 0.26, mats.metal, { castShadow: true });
    addBox(group, 0.055, 0.68, 0.055, lx, 0.35, -0.26, mats.metal, { castShadow: true });
    addBox(group, 0.065, 0.04, 0.62, lx, 0.02, 0, mats.metal);
  }
  addBox(group, 1.12, 0.05, 0.04, 0, 0.56, 0.26, mats.metal);

  // Under-desk 2-drawer cabinet (right side)
  addBox(group, 0.36, 0.54, 0.56, 0.36, 0.38, 0.02, mats.wood, { castShadow: true });
  for (const dy of [0.26, 0.5] as const) {
    addBox(group, 0.32, 0.2, 0.03, 0.36, dy, -0.27, mats.printerBody);
    addBox(group, 0.14, 0.025, 0.02, 0.36, dy + 0.02, -0.29, mats.metal);
  }

  // Ergonomic swivel chair positioned behind desk facing +Z
  const chair = createSwivelChair(mats, 1);
  chair.position.set(0, 0, -0.55);
  group.add(chair);

  // Monitor arm + angled base + bezel + glowing screen facing chair (-Z)
  addBox(group, 0.22, 0.02, 0.16, 0, 0.77, 0.16, mats.metal);
  addBox(group, 0.07, 0.22, 0.05, 0, 0.87, 0.18, mats.metal);
  addBox(group, 0.65, 0.38, 0.045, 0, 1.05, 0.15, mats.darkAccent, { castShadow: true });
  const screenMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-screen-off"),
    emissive: palette.getColor("--office-screen-on"),
    emissiveIntensity: 0.1,
  });
  const monitorScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.32), screenMat);
  monitorScreen.position.set(0, 1.05, 0.125);
  monitorScreen.rotation.y = Math.PI;
  group.add(monitorScreen);

  // Keyboard, mouse pad & mouse
  addBox(group, 0.42, 0.015, 0.16, -0.06, 0.768, -0.1, mats.white);
  addBox(group, 0.38, 0.018, 0.12, -0.06, 0.774, -0.1, mats.darkAccent);
  addBox(group, 0.16, 0.008, 0.18, 0.28, 0.764, -0.1, mats.darkAccent);
  addBox(group, 0.055, 0.024, 0.09, 0.28, 0.778, -0.1, mats.printerBody);

  // Coffee mug on left corner
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.038, 0.09, 10),
    mats.white,
  );
  mug.position.set(-0.48, 0.805, -0.08);
  group.add(mug);

  // Articulated desk lamp (left rear) with warm bulb toggled at dusk/night
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.025, 10), mats.metal);
  lampBase.position.set(-0.46, 0.775, 0.18);
  addBox(group, 0.025, 0.26, 0.025, -0.46, 0.9, 0.18, mats.metal, { rz: -0.2 });
  addBox(group, 0.16, 0.025, 0.025, -0.39, 1.02, 0.14, mats.metal, { ry: 0.35 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 10), mats.metal);
  shade.position.set(-0.33, 0.98, 0.11);
  shade.rotation.z = 0.3;
  const deskLampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.042, 8, 8),
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-lamp-warm"),
      emissive: palette.getColor("--office-lamp-warm"),
      emissiveIntensity: 0.1,
    }),
  );
  deskLampBulb.position.set(-0.33, 0.935, 0.11);
  group.add(lampBase, shade, deskLampBulb);

  if (hasTrophy) {
    const trophyMat = new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-trophy-gold"),
      metalness: 0.65,
      roughness: 0.25,
    });
    addBox(group, 0.14, 0.05, 0.14, 0.48, 0.785, 0.16, trophyMat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.09, 8), trophyMat);
    stem.position.set(0.48, 0.85, 0.16);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.12, 10), trophyMat);
    cup.position.set(0.48, 0.94, 0.16);
    group.add(stem, cup);
  }

  return { group, monitorScreen, deskLampBulb };
}

function buildSofa(mats: FurnitureSharedMaterials): THREE.Group {
  const g = new THREE.Group();
  // Tapered wooden plinth legs + lower deck
  for (const lx of [-0.82, 0.82] as const) {
    for (const lz of [-0.3, 0.3] as const) {
      addBox(g, 0.08, 0.1, 0.08, lx, 0.05, lz, mats.wood);
    }
  }
  addBox(g, 1.84, 0.12, 0.74, 0, 0.16, 0, mats.wood, { castShadow: true });
  // Plump seat cushions (2-seater split) + center piping accent
  for (const cx of [-0.41, 0.41] as const) {
    addBox(g, 0.79, 0.18, 0.66, cx, 0.31, 0.02, mats.sofaCloth, {
      castShadow: true,
      receiveShadow: true,
    });
  }
  addBox(g, 0.06, 0.16, 0.62, 0, 0.3, 0.02, mats.darkAccent);
  // Sculpted backrest + 2 angled accent throw pillows + side armrests (total width 1.88 <= 1.9)
  addBox(g, 1.84, 0.5, 0.18, 0, 0.56, -0.28, mats.sofaCloth, { castShadow: true });
  addBox(g, 1.82, 0.05, 0.16, 0, 0.82, -0.28, mats.wood);
  for (const sx of [-0.86, 0.86] as const) {
    addBox(g, 0.16, 0.38, 0.74, sx, 0.39, 0, mats.sofaCloth, { castShadow: true });
  }
  for (const px of [-0.66, 0.66] as const) {
    addBox(g, 0.24, 0.24, 0.1, px, 0.49, -0.13, mats.cushionAccent, { rz: px < 0 ? 0.14 : -0.14 });
  }
  return g;
}

function buildMeetingTable(mats: FurnitureSharedMaterials): THREE.Group {
  const g = new THREE.Group();
  // Oval/chamfered style wood conference top (2.2 x 1.0) on double T-pedestal
  addBox(g, 2.2, 0.07, 1.0, 0, 0.74, 0, mats.deskTop, { castShadow: true, receiveShadow: true });
  addBox(g, 2.24, 0.03, 1.04, 0, 0.7, 0, mats.metal);
  for (const px of [-0.65, 0.65] as const) {
    addBox(g, 0.12, 0.68, 0.14, px, 0.35, 0, mats.metal, { castShadow: true });
    addBox(g, 0.16, 0.04, 0.62, px, 0.02, 0, mats.metal);
  }
  // Tabletop center runner, speakerphone puck, laptops & folders
  addBox(g, 0.24, 0.035, 0.24, 0, 0.79, 0, mats.darkAccent);
  for (const lx of [-0.65, 0.65] as const) {
    addBox(g, 0.32, 0.015, 0.22, lx, 0.785, -0.22, mats.printerBody);
    addBox(g, 0.32, 0.2, 0.015, lx, 0.88, -0.12, mats.printerBody, { rx: -0.18 });
  }
  addBox(g, 0.26, 0.025, 0.18, -0.35, 0.788, 0.24, mats.white);
  addBox(g, 0.22, 0.02, 0.16, 0.45, 0.786, 0.24, mats.cushionAccent);

  // 4 tucked conference chairs (strictly inside 2.6 x 1.5 footprint!)
  for (const cx of [-0.55, 0.55] as const) {
    for (const sz of [-1, 1] as const) {
      const chair = createSwivelChair(mats, 0.84);
      chair.position.set(cx, 0, sz * 0.55);
      chair.rotation.y = sz < 0 ? 0 : Math.PI;
      g.add(chair);
    }
  }
  return g;
}

function buildCoffeeMachine(mats: FurnitureSharedMaterials, statusColor: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  // Bar cabinet + kickplate + stone counter top + front wood slats (1.06 x 0.66 <= 1.1 x 0.7)
  addBox(g, 1.02, 0.08, 0.62, 0, 0.04, 0, mats.darkAccent);
  addBox(g, 1.04, 0.72, 0.64, 0, 0.44, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 0.96, 0.52, 0.02, 0, 0.44, 0.325, mats.deskTop);
  addBox(g, 1.08, 0.05, 0.68, 0, 0.825, 0, mats.printerBody, { receiveShadow: true });
  // Espresso body, stainless drip tray, portafilter head, water tank, warm mug stack & pastry dome
  addBox(g, 0.46, 0.44, 0.38, -0.18, 1.07, -0.04, mats.metal, { castShadow: true });
  addBox(g, 0.44, 0.05, 0.14, -0.18, 0.875, 0.2, mats.darkAccent);
  addBox(g, 0.28, 0.14, 0.1, -0.18, 1.12, 0.16, mats.darkAccent);
  addBox(g, 0.14, 0.34, 0.28, 0.14, 1.02, -0.06, mats.glass);
  const mugCup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.09, 10), mats.white);
  mugCup.position.set(-0.18, 0.945, 0.21);
  g.add(mugCup);
  for (const offset of [0.24, 0.34] as const) {
    const stackMug = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.085, 10), mats.white);
    stackMug.position.set(offset, 0.89, -0.12);
    g.add(stackMug);
  }
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.16, 12), mats.glass);
  dome.position.set(0.36, 0.94, 0.12);
  addBox(g, 0.12, 0.06, 0.12, 0.36, 0.88, 0.12, mats.cushionAccent);
  g.add(dome);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.035, 0.03),
    new THREE.MeshStandardMaterial({
      color: statusColor,
      emissive: statusColor,
      emissiveIntensity: 0.75,
    }),
  );
  led.position.set(-0.32, 1.22, 0.16);
  g.add(led);
  return g;
}

function buildWaterCooler(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Lower chilled dispenser housing (0.44 x 0.44 <= 0.48 x 0.48)
  addBox(g, 0.44, 0.9, 0.44, 0, 0.45, 0, mats.white, { castShadow: true, receiveShadow: true });
  addBox(g, 0.34, 0.24, 0.04, 0, 0.72, 0.21, mats.darkAccent);
  addBox(g, 0.36, 0.035, 0.08, 0, 0.59, 0.22, mats.metal);
  // Hot/Cold levers
  addBox(
    g,
    0.045,
    0.06,
    0.04,
    -0.07,
    0.77,
    0.22,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-red"), roughness: 0.4 }),
  );
  addBox(
    g,
    0.045,
    0.06,
    0.04,
    0.07,
    0.77,
    0.22,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-water-jug"), roughness: 0.4 }),
  );
  // Side cup tube dispenser
  const cupTube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 10), mats.glass);
  cupTube.position.set(0.2, 0.68, 0.08);
  g.add(cupTube);
  // Translucent jug with neck & ribbed bands
  const jugMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-water-jug"),
    transparent: true,
    opacity: 0.75,
    roughness: 0.18,
  });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.08, 12), mats.printerBody);
  neck.position.y = 0.93;
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.44, 14), jugMat);
  jug.position.y = 1.18;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.165, 0.06, 14), jugMat);
  cap.position.y = 1.43;
  g.add(neck, jug, cap);
  return g;
}

function buildPlant(
  mats: FurnitureSharedMaterials,
  palette: OfficePalette,
  goalCompletionRatio: number,
): THREE.Group {
  const g = new THREE.Group();
  const growth = 0.55 + Math.max(0, Math.min(1, goalCompletionRatio)) * 0.75;
  // Tapered terracotta pot + rim + dark soil + wooden trunk + layered greenery (width <= 0.62)
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.36, 10), mats.pot);
  pot.position.y = 0.18;
  pot.castShadow = true;
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.21, 0.03, 10), mats.metal);
  saucer.position.y = 0.015;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 10), mats.pot);
  rim.position.y = 0.37;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.205, 0.05, 10), mats.white);
  band.position.y = 0.27;
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10), mats.darkAccent);
  soil.position.y = 0.385;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.38 * growth, 8), mats.wood);
  trunk.position.y = 0.38 + 0.19 * growth;
  g.add(saucer, pot, band, rim, soil, trunk);

  const lowerCanopy = new THREE.Mesh(new THREE.DodecahedronGeometry(0.27, 0), mats.leaf);
  lowerCanopy.scale.set(1, 0.85 * growth, 1);
  lowerCanopy.position.set(0, 0.55 + 0.22 * growth, 0);
  lowerCanopy.castShadow = true;

  const upperCanopy = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mats.leaf);
  upperCanopy.scale.set(1, 0.9 * growth, 1);
  upperCanopy.position.set(0.05, 0.62 + 0.42 * growth, -0.03);
  upperCanopy.castShadow = true;

  const sideFrond = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), mats.leaf);
  sideFrond.position.set(-0.14, 0.54 + 0.28 * growth, 0.08);
  g.add(lowerCanopy, upperCanopy, sideFrond);

  if (goalCompletionRatio >= 0.8) {
    const blossomMat = new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-blossom-gold"),
      emissive: palette.getColor("--office-blossom-gold"),
      emissiveIntensity: 0.3,
    });
    for (const [bx, by, bz] of [
      [0.14, 0.68 + 0.46 * growth, 0.12],
      [-0.12, 0.62 + 0.36 * growth, -0.1],
      [0.02, 0.72 + 0.54 * growth, -0.02],
    ] as const) {
      const blossom = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), blossomMat);
      blossom.position.set(bx, by, bz);
      g.add(blossom);
    }
  }
  return g;
}

function buildBookshelf(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Frame & plinth (0.90 x 0.38 <= 0.92 x 0.42)
  addBox(g, 0.88, 1.76, 0.34, 0, 0.88, -0.02, mats.wood, { castShadow: true });
  for (const sx of [-0.42, 0.42] as const) {
    addBox(g, 0.04, 1.78, 0.38, sx, 0.89, 0, mats.wood);
  }

  const bookColors: OfficeColorToken[] = [
    "--office-book-red",
    "--office-book-teal",
    "--office-book-gold",
    "--office-palette-sky",
  ];
  const bookMats = bookColors.map(
    (tok) => new THREE.MeshStandardMaterial({ color: palette.getColor(tok), roughness: 0.72 }),
  );
  for (let s = 0; s < 3; s++) {
    const sy = 0.42 + s * 0.48;
    addBox(g, 0.88, 0.045, 0.38, 0, sy - 0.16, 0, mats.wood);
    for (let b = 0; b < 5; b++) {
      const h = 0.22 + ((s + b) % 3) * 0.04;
      const tilt = s === 1 && b === 4 ? 0.18 : 0;
      addBox(
        g,
        0.11,
        h,
        0.22,
        -0.31 + b * 0.155,
        sy - 0.14 + h / 2,
        0.07,
        bookMats[(s * 2 + b) % bookMats.length]!,
        { rz: tilt },
      );
    }
  }
  addBox(g, 0.9, 0.05, 0.4, 0, 1.78, 0, mats.wood);
  // Decorative top-shelf potted trailing plant & brass trophy ornament
  addBox(g, 0.14, 0.12, 0.14, -0.26, 1.86, 0, mats.pot);
  addBox(g, 0.2, 0.16, 0.2, -0.26, 1.98, 0, mats.leaf);
  addBox(
    g,
    0.12,
    0.18,
    0.12,
    0.26,
    1.89,
    0,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-gold"), metalness: 0.55, roughness: 0.3 }),
  );
  return g;
}

function buildPrinter(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Base cabinet (0.74 x 0.56 <= 0.76 x 0.60) + copier top + ADF lid + output sheet
  addBox(g, 0.74, 0.62, 0.56, 0, 0.31, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 0.66, 0.28, 0.48, 0, 0.76, -0.02, mats.printerBody, { castShadow: true });
  addBox(g, 0.52, 0.14, 0.03, 0, 0.74, 0.23, mats.white);
  addBox(g, 0.66, 0.06, 0.46, 0, 0.93, -0.02, mats.metal);
  addBox(g, 0.32, 0.02, 0.18, 0, 0.75, 0.2, mats.white);
  addBox(g, 0.18, 0.04, 0.09, 0.2, 0.92, 0.22, mats.darkAccent);
  const readyColor = palette.getColor("--office-status-healthy");
  addBox(
    g,
    0.05,
    0.025,
    0.02,
    0.24,
    0.945,
    0.23,
    new THREE.MeshStandardMaterial({
      color: readyColor,
      emissive: readyColor,
      emissiveIntensity: 0.85,
    }),
  );
  return g;
}

function buildFilingCabinet(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 0.54, 1.4, 0.5, 0, 0.7, 0, mats.metal, { castShadow: true, receiveShadow: true });
  for (const dy of [0.3, 0.7, 1.1] as const) {
    addBox(g, 0.46, 0.32, 0.035, 0, dy, 0.255, mats.printerBody);
    addBox(g, 0.18, 0.028, 0.035, 0, dy + 0.05, 0.28, mats.metal);
    addBox(g, 0.12, 0.05, 0.015, 0, dy - 0.04, 0.275, mats.white);
  }
  // Stacked colored binders on top
  addBox(
    g,
    0.34,
    0.04,
    0.26,
    -0.03,
    1.42,
    0,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-teal"), roughness: 0.6 }),
  );
  addBox(
    g,
    0.28,
    0.035,
    0.22,
    0.02,
    1.46,
    0.02,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-gold"), roughness: 0.6 }),
  );
  return g;
}

function buildServerRack(mats: FurnitureSharedMaterials, statusColor: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 0.86, 2.0, 0.86, 0, 1.0, 0, mats.metal, { castShadow: true });
  addBox(g, 0.76, 1.84, 0.04, 0, 1.0, 0.43, mats.darkAccent);
  const ledMat = new THREE.MeshStandardMaterial({
    color: statusColor,
    emissive: statusColor,
    emissiveIntensity: 0.85,
  });
  for (const sy of [0.45, 0.8, 1.15, 1.5, 1.75] as const) {
    addBox(g, 0.68, 0.18, 0.03, 0, sy, 0.445, mats.printerBody);
    addBox(g, 0.44, 0.04, 0.025, -0.06, sy + 0.03, 0.46, ledMat);
  }
  return g;
}

function buildWhiteboard(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();

  // Freestanding rolling steel A/T stand grounded flush on y = 0
  for (const sx of [-0.855, 0.855] as const) {
    // Vertical steel upright post + side pivot clamp bracket
    addBox(g, 0.055, 1.44, 0.055, sx, 0.78, 0, mats.metal, { castShadow: true });
    addBox(g, 0.06, 0.14, 0.09, sx > 0 ? 0.82 : -0.82, 1.38, 0, mats.darkAccent);
    // Horizontal T-base floor runner + 2 rolling caster wheels flush at y = 0
    addBox(g, 0.06, 0.05, 0.44, sx, 0.075, 0, mats.metal, { castShadow: true });
    for (const sz of [-0.18, 0.18] as const) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10),
        mats.darkAccent,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.03, sz);
      g.add(wheel);
    }
  }
  // Lower crossbar stabilizer & under-board support rail
  addBox(g, 1.66, 0.045, 0.045, 0, 0.24, 0, mats.metal, { castShadow: true });
  addBox(g, 1.66, 0.04, 0.05, 0, 0.79, 0, mats.metal);

  // Kanban whiteboard frame & dual-sided dry-erase panel
  addBox(g, 1.66, 1.12, 0.08, 0, 1.38, 0, mats.metal, { castShadow: true });
  addBox(g, 1.54, 1.0, 0.095, 0, 1.38, 0, mats.white);
  addBox(g, 1.44, 0.035, 0.09, 0, 0.81, 0.07, mats.metal);

  // Markers & eraser on marker tray
  addBox(
    g,
    0.1,
    0.025,
    0.045,
    -0.46,
    0.84,
    0.085,
    mats.darkAccent,
  );
  addBox(
    g,
    0.12,
    0.018,
    0.018,
    -0.28,
    0.836,
    0.085,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-red"), roughness: 0.45 }),
  );
  addBox(
    g,
    0.12,
    0.018,
    0.018,
    -0.12,
    0.836,
    0.085,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-palette-sky"), roughness: 0.45 }),
  );

  // 2 Kanban vertical column dividers
  for (const dx of [-0.25, 0.25] as const) {
    addBox(g, 0.015, 0.92, 0.01, dx, 1.38, 0.05, mats.metal);
  }

  // 5 colorful sticky cards across 3 Kanban columns
  const stickyTokens: OfficeColorToken[] = [
    "--office-book-gold",
    "--office-palette-sky",
    "--office-book-red",
    "--office-book-teal",
    "--office-book-gold",
  ];
  const stickyCoords: ReadonlyArray<[number, number]> = [
    [-0.52, 1.62],
    [-0.5, 1.36],
    [0.0, 1.54],
    [0.02, 1.24],
    [0.5, 1.48],
  ];
  for (let i = 0; i < stickyCoords.length; i++) {
    const [sx, sy] = stickyCoords[i]!;
    addBox(
      g,
      0.22,
      0.16,
      0.014,
      sx,
      sy,
      0.056,
      new THREE.MeshStandardMaterial({ color: palette.getColor(stickyTokens[i]!), roughness: 0.6 }),
    );
  }
  return g;
}

function buildApprovalDesk(mats: FurnitureSharedMaterials, statusColor: THREE.Color, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 1.36, 0.84, 0.76, 0, 0.42, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 1.4, 0.04, 0.8, 0, 0.86, 0, mats.deskTop);
  // Paper inbox tray & status stamp light
  addBox(g, 0.34, 0.08, 0.26, -0.34, 0.92, 0, mats.metal);
  addBox(g, 0.28, 0.06, 0.2, -0.34, 0.95, 0, mats.white);
  addBox(
    g,
    0.36,
    0.14,
    0.26,
    0.26,
    0.95,
    0,
    new THREE.MeshStandardMaterial({
      color: statusColor,
      emissive: statusColor,
      emissiveIntensity: 0.55,
    }),
  );
  addBox(
    g,
    0.14,
    0.1,
    0.14,
    0.26,
    1.04,
    0,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-gold"), roughness: 0.4 }),
  );
  return g;
}

function buildHrReception(mats: FurnitureSharedMaterials, statusColor: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 1.76, 0.96, 0.72, 0, 0.48, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 1.8, 0.05, 0.75, 0, 0.985, 0, mats.deskTop);
  // Desktop monitor + nameplate sign
  addBox(g, 0.46, 0.3, 0.05, -0.42, 1.18, -0.08, mats.darkAccent);
  addBox(
    g,
    0.82,
    0.24,
    0.07,
    0.15,
    1.22,
    0.26,
    new THREE.MeshStandardMaterial({
      color: statusColor,
      emissive: statusColor,
      emissiveIntensity: 0.45,
    }),
  );
  return g;
}

function buildRoutinesClock(mats: FurnitureSharedMaterials, statusColor: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 0.62, 1.8, 0.38, 0, 0.9, 0, mats.metal, { castShadow: true });
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.05, 16),
    new THREE.MeshStandardMaterial({
      color: mats.white.color,
      emissive: statusColor,
      emissiveIntensity: 0.3,
    }),
  );
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 1.42, 0.21);
  addBox(g, 0.03, 0.14, 0.02, 0, 1.48, 0.245, mats.darkAccent);
  addBox(g, 0.12, 0.025, 0.02, 0.05, 1.42, 0.245, mats.darkAccent);
  g.add(face);
  return g;
}

function buildArtifactsShowcase(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  addBox(g, 1.18, 0.88, 0.58, 0, 0.44, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 0.86, 0.48, 0.42, 0, 1.12, 0, mats.glass);
  addBox(g, 0.88, 0.04, 0.44, 0, 1.38, 0, mats.metal);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.14, 0),
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-trophy-gold"),
      emissive: palette.getColor("--office-trophy-gold"),
      emissiveIntensity: 0.35,
      metalness: 0.55,
      roughness: 0.2,
    }),
  );
  gem.position.set(0, 1.12, 0);
  g.add(gem);
  return g;
}

function buildAquarium(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Wood/metal stand cabinet (1.34 x 0.50 <= 1.40 x 0.56)
  addBox(g, 1.34, 0.72, 0.5, 0, 0.36, 0, mats.wood, { castShadow: true, receiveShadow: true });
  addBox(g, 1.38, 0.05, 0.54, 0, 0.74, 0, mats.darkAccent);

  // Illuminated aquarium tank with sand bed, aquatic plants & colorful voxel fish
  const waterMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-water-pond"),
    emissive: palette.getColor("--office-screen-on"),
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 0.58,
    roughness: 0.12,
  });
  addBox(g, 1.28, 0.06, 0.44, 0, 0.795, 0, mats.deskTop);
  addBox(g, 1.28, 0.62, 0.44, 0, 1.13, 0, waterMat);
  // Corner glass frame posts & glowing light hood
  for (const sx of [-0.64, 0.64] as const) {
    for (const sz of [-0.22, 0.22] as const) {
      addBox(g, 0.035, 0.64, 0.035, sx, 1.14, sz, mats.darkAccent);
    }
  }
  addBox(g, 1.34, 0.08, 0.48, 0, 1.48, 0, mats.darkAccent, { castShadow: true });

  // Coral, kelp fronds & 4 bright fish inside tank
  addBox(g, 0.08, 0.28, 0.08, -0.4, 0.96, -0.05, mats.leaf);
  addBox(g, 0.08, 0.24, 0.08, 0.38, 0.94, 0.06, mats.leaf);
  addBox(g, 0.14, 0.14, 0.12, 0.08, 0.89, -0.04, mats.pot);

  const koiMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-animal-koi"), roughness: 0.4 });
  const goldMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-blossom-gold"), roughness: 0.4 });
  for (const [fx, fy, fz, fmat] of [
    [-0.25, 1.16, 0.06, koiMat],
    [0.18, 1.24, -0.05, goldMat],
    [-0.04, 1.05, 0.02, koiMat],
    [0.42, 1.12, -0.02, goldMat],
  ] as const) {
    addBox(g, 0.14, 0.065, 0.05, fx, fy, fz, fmat);
  }
  return g;
}

function buildArcadeMachine(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Retro upright arcade cabinet (0.72 x 0.64 <= 0.78 x 0.72)
  addBox(g, 0.72, 0.92, 0.64, 0, 0.46, 0, mats.metal, { castShadow: true, receiveShadow: true });
  addBox(g, 0.72, 0.76, 0.46, 0, 1.3, -0.09, mats.metal, { castShadow: true });
  addBox(g, 0.72, 0.22, 0.56, 0, 1.78, -0.04, mats.metal, { castShadow: true });
  // Glowing marquee & retro CRT display screen
  addBox(
    g,
    0.64,
    0.15,
    0.04,
    0,
    1.78,
    0.24,
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-trophy-gold"),
      emissive: palette.getColor("--office-trophy-gold"),
      emissiveIntensity: 0.7,
    }),
  );
  addBox(
    g,
    0.58,
    0.44,
    0.04,
    0,
    1.32,
    0.13,
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-screen-off"),
      emissive: palette.getColor("--office-screen-on"),
      emissiveIntensity: 0.68,
    }),
    { rx: -0.18 },
  );
  // Slanted control deck with joystick + colorful arcade buttons
  addBox(g, 0.7, 0.07, 0.28, 0, 0.96, 0.2, mats.darkAccent);
  addBox(g, 0.03, 0.11, 0.03, -0.18, 1.04, 0.22, mats.printerBody);
  addBox(
    g,
    0.065,
    0.065,
    0.065,
    -0.18,
    1.1,
    0.22,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-red"), roughness: 0.35 }),
  );
  addBox(
    g,
    0.055,
    0.025,
    0.055,
    0.08,
    1.0,
    0.22,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-status-healthy"), roughness: 0.4 }),
  );
  addBox(
    g,
    0.055,
    0.025,
    0.055,
    0.18,
    1.0,
    0.22,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-palette-sky"), roughness: 0.4 }),
  );
  // Coin return door on front panel
  addBox(g, 0.28, 0.34, 0.03, 0, 0.46, 0.32, mats.darkAccent);
  addBox(
    g,
    0.06,
    0.06,
    0.02,
    -0.06,
    0.54,
    0.34,
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-book-red"),
      emissive: palette.getColor("--office-book-red"),
      emissiveIntensity: 0.55,
    }),
  );
  return g;
}

function buildFloorLamp(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Weighted plinth + slender brass/dark stem + warm drum shade + tagged bulb (0.42 x 0.42 <= 0.52 x 0.52)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.04, 12), mats.metal);
  base.position.y = 0.02;
  base.castShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 1.48, 10), mats.metal);
  pole.position.y = 0.76;
  pole.castShadow = true;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.23, 0.36, 14, 1, true),
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-animal-cream"),
      emissive: palette.getColor("--office-lamp-warm"),
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      roughness: 0.6,
    }),
  );
  shade.position.y = 1.62;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 10, 10),
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-lamp-warm"),
      emissive: palette.getColor("--office-lamp-warm"),
      emissiveIntensity: 0.35,
    }),
  );
  bulb.name = "office-lamp-bulb";
  bulb.position.y = 1.58;
  g.add(base, pole, shade, bulb);
  return g;
}

function buildLoungeTable(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Low walnut coffee table + lower tray + books + ceramic cup + mini succulent (1.04 x 0.60 <= 1.1 x 0.65)
  for (const lx of [-0.44, 0.44] as const) {
    for (const lz of [-0.23, 0.23] as const) {
      addBox(g, 0.055, 0.38, 0.055, lx, 0.19, lz, mats.metal, { castShadow: true });
    }
  }
  addBox(g, 0.94, 0.03, 0.48, 0, 0.14, 0, mats.wood, { receiveShadow: true });
  addBox(g, 1.04, 0.05, 0.6, 0, 0.4, 0, mats.deskTop, { castShadow: true, receiveShadow: true });
  addBox(
    g,
    0.26,
    0.035,
    0.2,
    -0.25,
    0.44,
    0.05,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-teal"), roughness: 0.65 }),
  );
  addBox(
    g,
    0.22,
    0.03,
    0.18,
    -0.24,
    0.47,
    0.04,
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-red"), roughness: 0.65 }),
  );
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.075, 10), mats.white);
  mug.position.set(0.18, 0.46, 0.1);
  const miniPot = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.09, 10), mats.pot);
  miniPot.position.set(0.3, 0.47, -0.1);
  const succulent = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), mats.leaf);
  succulent.position.set(0.3, 0.54, -0.1);
  g.add(mug, miniPot, succulent);
  return g;
}

function buildVendingMachine(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Refrigerated snack & drink vending machine (0.90 x 0.64 <= 0.95 x 0.68)
  addBox(g, 0.9, 1.92, 0.64, 0, 0.96, 0, mats.metal, { castShadow: true, receiveShadow: true });
  // Glass display window + 3 stocked shelves
  addBox(g, 0.56, 1.18, 0.04, -0.1, 1.24, 0.31, mats.glass);
  const itemMats = [
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-red"), roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-gold"), roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-palette-sky"), roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: palette.getColor("--office-book-teal"), roughness: 0.45 }),
  ];
  for (let row = 0; row < 3; row++) {
    const ry = 0.88 + row * 0.34;
    addBox(g, 0.52, 0.025, 0.24, -0.1, ry - 0.08, 0.18, mats.printerBody);
    for (let col = 0; col < 4; col++) {
      addBox(
        g,
        0.09,
        0.15,
        0.09,
        -0.28 + col * 0.12,
        ry + 0.01,
        0.2,
        itemMats[(row + col) % itemMats.length]!,
      );
    }
  }
  // Keypad, digital screen & pickup flap
  addBox(g, 0.16, 0.44, 0.04, 0.3, 1.28, 0.32, mats.darkAccent);
  addBox(
    g,
    0.1,
    0.08,
    0.02,
    0.3,
    1.42,
    0.34,
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-status-healthy"),
      emissive: palette.getColor("--office-status-healthy"),
      emissiveIntensity: 0.7,
    }),
  );
  addBox(g, 0.56, 0.22, 0.06, -0.1, 0.36, 0.31, mats.darkAccent);
  return g;
}

function buildOutdoorTree(
  mats: FurnitureSharedMaterials,
  palette: OfficePalette,
  variant: "sakura" | "oak" | "pine",
): THREE.Group {
  const g = new THREE.Group();
  // Root base + trunk + layered foliage clipped cleanly within 1.4x1.4 / 1.2x1.2 footprint
  addBox(g, 0.54, 0.14, 0.54, 0, 0.07, 0, mats.wood, { castShadow: true });
  if (variant === "pine") {
    const pineMat = new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-pine-leaf"),
      roughness: 0.86,
    });
    addBox(g, 0.28, 1.0, 0.28, 0, 0.5, 0, mats.wood, { castShadow: true });
    addBox(g, 1.12, 0.72, 1.12, 0, 1.16, 0, pineMat, { castShadow: true });
    addBox(g, 0.84, 0.65, 0.84, 0, 1.76, 0, pineMat, { castShadow: true });
    addBox(g, 0.52, 0.58, 0.52, 0, 2.28, 0, pineMat, { castShadow: true });
    return g;
  }

  const primaryMat = new THREE.MeshStandardMaterial({
    color: palette.getColor(
      variant === "sakura" ? "--office-sakura-blossom" : "--office-plant-leaf",
    ),
    roughness: 0.82,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: palette.getColor(
      variant === "sakura" ? "--office-sakura-blossom" : "--office-ground-grass-alt",
    ),
    roughness: 0.86,
  });
  addBox(g, 0.3, 1.25, 0.3, 0, 0.62, 0, mats.wood, { castShadow: true });
  addBox(g, 1.3, 0.78, 1.28, 0, 1.56, 0, primaryMat, { castShadow: true });
  addBox(g, 0.94, 0.58, 0.94, 0.12, 2.08, -0.08, accentMat, { castShadow: true });
  addBox(g, 0.78, 0.45, 0.78, -0.16, 1.88, 0.12, primaryMat, { castShadow: true });
  return g;
}

function buildOutdoorBench(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  const benchWood = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-fence-wood"),
    roughness: 0.76,
  });
  // Fits cleanly inside 1.5 x 0.65 footprint
  for (const lx of [-0.56, 0.56] as const) {
    addBox(g, 0.08, 0.38, 0.5, lx, 0.19, 0, mats.metal, { castShadow: true });
  }
  addBox(g, 1.42, 0.08, 0.54, 0, 0.4, 0, benchWood, { castShadow: true, receiveShadow: true });
  addBox(g, 1.42, 0.34, 0.08, 0, 0.64, -0.22, benchWood, { castShadow: true });
  return g;
}

function buildOutdoorLamp(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-ground-stone"),
    roughness: 0.82,
  });
  addBox(g, 0.3, 0.22, 0.3, 0, 0.11, 0, stoneMat, { castShadow: true });
  addBox(g, 0.12, 2.1, 0.12, 0, 1.25, 0, mats.metal, { castShadow: true });
  addBox(g, 0.34, 0.07, 0.34, 0, 2.34, 0, mats.metal);
  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.26, 0.22),
    new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-lamp-warm"),
      emissive: palette.getColor("--office-lamp-warm"),
      emissiveIntensity: 0.35,
    }),
  );
  bulb.name = "office-lamp-bulb";
  bulb.position.y = 2.5;
  addBox(g, 0.38, 0.09, 0.38, 0, 2.66, 0, mats.metal);
  g.add(bulb);
  return g;
}

function buildOutdoorFlowerBed(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  const curbMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-fence-wood"),
    roughness: 0.8,
  });
  const tokens: OfficeColorToken[] = [
    "--office-sakura-blossom",
    "--office-blossom-gold",
    "--office-palette-sky",
    "--office-book-red",
  ];
  const flowerMats = tokens.map(
    (tok) => new THREE.MeshStandardMaterial({ color: palette.getColor(tok), roughness: 0.72 }),
  );
  // 1.32 x 0.84 <= 1.4 x 0.9 footprint
  addBox(g, 1.32, 0.2, 0.84, 0, 0.1, 0, curbMat, { castShadow: true, receiveShadow: true });
  addBox(g, 1.18, 0.22, 0.7, 0, 0.22, 0, mats.leaf, { receiveShadow: true });
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz += 2) {
      addBox(
        g,
        0.18,
        0.14,
        0.18,
        ix * 0.36,
        0.38,
        iz * 0.18,
        flowerMats[(ix + iz + 4) % flowerMats.length]!,
      );
    }
  }
  return g;
}

function buildKpiScreen(mats: FurnitureSharedMaterials, palette: OfficePalette): THREE.Group {
  const g = new THREE.Group();
  // Freestanding steel base feet & dual upright stand posts (1.76 x 0.42 <= 1.85 x 0.45)
  for (const sx of [-0.62, 0.62] as const) {
    addBox(g, 0.14, 0.04, 0.4, sx, 0.02, 0, mats.metal, { castShadow: true });
    addBox(g, 0.06, 1.38, 0.06, sx, 0.72, -0.04, mats.metal, { castShadow: true });
  }
  addBox(g, 1.32, 0.04, 0.05, 0, 0.32, -0.04, mats.metal);

  // Dark slim bezel chassis & glowing status bar top
  addBox(g, 1.76, 1.02, 0.09, 0, 1.46, 0, mats.darkAccent, { castShadow: true });
  const headerGlow = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-status-healthy"),
    emissive: palette.getColor("--office-status-healthy"),
    emissiveIntensity: 0.9,
  });
  addBox(g, 1.62, 0.035, 0.03, 0, 1.94, 0.048, headerGlow);

  // Front live CanvasTexture screen plane
  const screenMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-sky-day-top"),
    emissive: palette.getColor("--office-screen-on"),
    emissiveIntensity: 0.25,
    roughness: 0.35,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.86), screenMat);
  screen.name = "kpi-live-screen";
  screen.position.set(0, 1.44, 0.052);
  g.add(screen);
  return g;
}

/**
 * Builds stylized procedural 3D furniture strictly inside each item's collision footprint.
 */
export function buildFurnitureAssembly(params: {
  kind: FurnitureKind;
  palette: OfficePalette;
  statusColor: THREE.Color;
  goalCompletionRatio: number;
}): THREE.Group {
  const { kind, palette, statusColor, goalCompletionRatio } = params;
  const mats = createSharedMaterials(palette);

  switch (kind) {
    case "approval_desk":
      return buildApprovalDesk(mats, statusColor, palette);
    case "server_rack":
      return buildServerRack(mats, statusColor);
    case "hr_reception":
      return buildHrReception(mats, statusColor);
    case "routines_clock":
      return buildRoutinesClock(mats, statusColor);
    case "artifacts_showcase":
      return buildArtifactsShowcase(mats, palette);
    case "whiteboard":
      return buildWhiteboard(mats, palette);
    case "coffee_machine":
      return buildCoffeeMachine(mats, statusColor);
    case "meeting_table":
      return buildMeetingTable(mats);
    case "sofa":
      return buildSofa(mats);
    case "bookshelf":
      return buildBookshelf(mats, palette);
    case "water_cooler":
      return buildWaterCooler(mats, palette);
    case "printer":
      return buildPrinter(mats, palette);
    case "filing_cabinet":
      return buildFilingCabinet(mats, palette);
    case "aquarium":
      return buildAquarium(mats, palette);
    case "arcade_machine":
      return buildArcadeMachine(mats, palette);
    case "floor_lamp":
      return buildFloorLamp(mats, palette);
    case "lounge_table":
      return buildLoungeTable(mats, palette);
    case "vending_machine":
      return buildVendingMachine(mats, palette);
    case "outdoor_sakura_tree":
      return buildOutdoorTree(mats, palette, "sakura");
    case "outdoor_oak_tree":
      return buildOutdoorTree(mats, palette, "oak");
    case "outdoor_pine_tree":
      return buildOutdoorTree(mats, palette, "pine");
    case "outdoor_bench":
      return buildOutdoorBench(mats, palette);
    case "outdoor_lamp":
      return buildOutdoorLamp(mats, palette);
    case "outdoor_flower_bed":
      return buildOutdoorFlowerBed(mats, palette);
    case "kpi_screen":
      return buildKpiScreen(mats, palette);
    case "plant":
    default:
      return buildPlant(mats, palette, goalCompletionRatio);
  }
}

/**
 * Builds a small handheld 3D prop attached to the player character's right hand.
 */
export function buildHeldItemMesh(kind: OfficeItemKind, palette: OfficePalette): THREE.Group {
  const group = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-outfit-shirt"),
    roughness: 0.45,
  });
  const inkMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-accessory-dark"),
    roughness: 0.7,
  });

  switch (kind) {
    case "water_cup": {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.052, 0.14, 12), whiteMat);
      cup.castShadow = true;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.06, 0.032, 12),
        new THREE.MeshStandardMaterial({
          color: palette.getColor("--office-palette-sky"),
          roughness: 0.45,
        }),
      );
      band.position.y = 0.012;
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062, 0.062, 0.022, 12),
        new THREE.MeshStandardMaterial({
          color: palette.getColor("--office-water-jug"),
          transparent: true,
          opacity: 0.88,
        }),
      );
      water.position.y = 0.062;
      group.add(cup, band, water);
      return group;
    }
    case "coffee_cup": {
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.058, 0.14, 12),
        new THREE.MeshStandardMaterial({
          color: palette.getColor("--office-palette-amber"),
          roughness: 0.4,
        }),
      );
      mug.castShadow = true;
      const coffee = new THREE.Mesh(
        new THREE.CylinderGeometry(0.058, 0.058, 0.018, 12),
        new THREE.MeshStandardMaterial({
          color: palette.getColor("--office-furniture-accent"),
          roughness: 0.3,
        }),
      );
      coffee.position.y = 0.064;
      addBox(group, 0.036, 0.075, 0.042, 0.065, 0, 0, whiteMat);
      group.add(mug, coffee);
      return group;
    }
    case "document": {
      addBox(group, 0.2, 0.025, 0.26, 0, 0, 0.05, whiteMat, { castShadow: true });
      addBox(
        group,
        0.205,
        0.012,
        0.055,
        0,
        0.016,
        -0.02,
        new THREE.MeshStandardMaterial({ color: palette.getColor("--office-palette-sky"), roughness: 0.5 }),
      );
      for (const lz of [0.04, 0.08, 0.12] as const) {
        addBox(group, 0.14, 0.006, 0.016, 0, 0.015, lz, inkMat);
      }
      return group;
    }
    case "handbook":
    default: {
      const coverMat = new THREE.MeshStandardMaterial({
        color: palette.getColor("--office-book-red"),
        roughness: 0.65,
      });
      const goldMat = new THREE.MeshStandardMaterial({
        color: palette.getColor("--office-book-gold"),
        roughness: 0.4,
      });
      // Openable hardcover silhouette with bright cream pages & gold bookmark
      addBox(group, 0.2, 0.036, 0.26, 0, 0, 0.04, coverMat, { castShadow: true });
      addBox(group, 0.175, 0.024, 0.235, 0.005, 0.012, 0.04, whiteMat);
      addBox(group, 0.018, 0.028, 0.23, 0, 0.014, 0.04, inkMat);
      for (const lx of [-0.045, 0.045] as const) {
        addBox(group, 0.055, 0.006, 0.16, lx, 0.026, 0.04, inkMat);
      }
      addBox(group, 0.024, 0.04, 0.22, 0, 0.008, 0.055, goldMat);
      return group;
    }
  }
}

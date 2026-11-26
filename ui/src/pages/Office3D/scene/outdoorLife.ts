import * as THREE from "three";
import {
  getCampusFountainCenter,
  getCampusPondBounds,
} from "../model/constants";
import type { WeatherKind } from "../model/types";
import type { OfficePalette } from "./palette";

export type OutdoorInteractableKind =
  | "outdoor_dog"
  | "outdoor_cat"
  | "outdoor_rabbit"
  | "outdoor_koi_pond"
  | "outdoor_fountain";

export interface OutdoorInteractableTarget {
  id: string;
  kind: OutdoorInteractableKind;
  label: string;
  x: number;
  z: number;
  interactionRadius: number;
  following?: boolean;
}

export interface OutdoorInteractionResult {
  kind: OutdoorInteractableKind;
  label: string;
  x: number;
  z: number;
  pose: "petting" | "feeding";
  feedbackKind:
    | "pet_dog_follow"
    | "pet_dog_stay"
    | "pet_cat"
    | "pet_rabbit"
    | "feed_koi"
    | "toss_coin";
}

export interface OutdoorLifeHandle {
  root: THREE.Group;
  update: (
    dt: number,
    elapsedSec: number,
    weather: WeatherKind,
    reducedMotion: boolean,
    playerPos?: { x: number; z: number; isIndoors: boolean },
    isNight?: boolean,
  ) => void;
  findNearestInteractable: (px: number, pz: number) => OutdoorInteractableTarget | null;
  interact: (id: string, playerPos: { x: number; z: number }) => OutdoorInteractionResult | null;
  getClickableEntries: () => Array<{ id: string; object: THREE.Object3D }>;
}

interface PatrolWaypoint {
  x: number;
  z: number;
}

interface WalkingCritter {
  id: string;
  name: string;
  kind: "dog" | "cat";
  group: THREE.Group;
  legs: THREE.Mesh[];
  tail: THREE.Mesh;
  waypoints: PatrolWaypoint[];
  waypointIndex: number;
  pauseTimer: number;
  happyTimer: number;
  happyFaceTarget: { x: number; z: number } | null;
  followingPlayer: boolean;
  speed: number;
  baseY: number;
  phase: number;
}

interface HoppingRabbit {
  id: string;
  name: string;
  group: THREE.Group;
  earL: THREE.Mesh;
  earR: THREE.Mesh;
  originX: number;
  originZ: number;
  radiusX: number;
  radiusZ: number;
  happyTimer: number;
  happyFaceTarget: { x: number; z: number } | null;
  baseY: number;
  phase: number;
  speed: number;
}

interface SwimmingKoi {
  group: THREE.Group;
  tail: THREE.Mesh;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  baseY: number;
  phase: number;
  speed: number;
}

interface FlyingWingedCritter {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  baseY: number;
  phase: number;
  speed: number;
  flapRate: number;
  hideInBadWeather: boolean;
}

interface FountainDroplet {
  mesh: THREE.Mesh;
  angle: number;
  speedXZ: number;
  speedY: number;
  phase: number;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

function addCritterBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

function buildDogRig(
  furMat: THREE.Material,
  creamMat: THREE.Material,
  darkMat: THREE.Material,
): { group: THREE.Group; legs: THREE.Mesh[]; tail: THREE.Mesh } {
  const g = new THREE.Group();
  // Torso + chest fur
  addCritterBox(g, 0.34, 0.24, 0.56, 0, 0.3, 0, furMat);
  addCritterBox(g, 0.28, 0.18, 0.14, 0, 0.28, 0.25, creamMat);
  // Head + snout + nose + eyes + pointed ears
  addCritterBox(g, 0.26, 0.24, 0.26, 0, 0.46, 0.34, furMat);
  addCritterBox(g, 0.16, 0.12, 0.14, 0, 0.41, 0.49, creamMat);
  addCritterBox(g, 0.06, 0.05, 0.04, 0, 0.45, 0.56, darkMat, false);
  addCritterBox(g, 0.04, 0.04, 0.02, -0.07, 0.49, 0.47, darkMat, false);
  addCritterBox(g, 0.04, 0.04, 0.02, 0.07, 0.49, 0.47, darkMat, false);
  addCritterBox(g, 0.07, 0.1, 0.06, -0.08, 0.62, 0.3, furMat);
  addCritterBox(g, 0.07, 0.1, 0.06, 0.08, 0.62, 0.3, furMat);

  // Legs (pivoted from top socket via local offset)
  const legs = [
    addCritterBox(g, 0.08, 0.22, 0.08, -0.1, 0.11, 0.2, creamMat),
    addCritterBox(g, 0.08, 0.22, 0.08, 0.1, 0.11, 0.2, creamMat),
    addCritterBox(g, 0.08, 0.22, 0.08, -0.1, 0.11, -0.2, furMat),
    addCritterBox(g, 0.08, 0.22, 0.08, 0.1, 0.11, -0.2, furMat),
  ];

  // Curled wagging tail
  const tail = addCritterBox(g, 0.07, 0.2, 0.08, 0, 0.44, -0.31, creamMat);
  tail.rotation.x = -0.5;
  return { group: g, legs, tail };
}

function buildCatRig(
  furMat: THREE.Material,
  creamMat: THREE.Material,
  darkMat: THREE.Material,
): { group: THREE.Group; legs: THREE.Mesh[]; tail: THREE.Mesh } {
  const g = new THREE.Group();
  // Slender torso + cream bib
  addCritterBox(g, 0.22, 0.18, 0.44, 0, 0.23, 0, furMat);
  addCritterBox(g, 0.18, 0.12, 0.12, 0, 0.22, 0.19, creamMat);
  // Head + small ears + eyes
  addCritterBox(g, 0.22, 0.19, 0.2, 0, 0.35, 0.26, furMat);
  addCritterBox(g, 0.06, 0.08, 0.05, -0.07, 0.47, 0.24, furMat);
  addCritterBox(g, 0.06, 0.08, 0.05, 0.07, 0.47, 0.24, furMat);
  addCritterBox(g, 0.035, 0.035, 0.02, -0.055, 0.37, 0.36, darkMat, false);
  addCritterBox(g, 0.035, 0.035, 0.02, 0.055, 0.37, 0.36, darkMat, false);

  const legs = [
    addCritterBox(g, 0.06, 0.16, 0.06, -0.07, 0.08, 0.15, creamMat),
    addCritterBox(g, 0.06, 0.16, 0.06, 0.07, 0.08, 0.15, creamMat),
    addCritterBox(g, 0.06, 0.16, 0.06, -0.07, 0.08, -0.15, furMat),
    addCritterBox(g, 0.06, 0.16, 0.06, 0.07, 0.08, -0.15, furMat),
  ];

  const tail = addCritterBox(g, 0.05, 0.26, 0.05, 0, 0.37, -0.24, furMat);
  tail.rotation.x = -0.35;
  return { group: g, legs, tail };
}

function buildRabbitRig(
  bodyMat: THREE.Material,
  earAccentMat: THREE.Material,
  darkMat: THREE.Material,
): { group: THREE.Group; earL: THREE.Mesh; earR: THREE.Mesh } {
  const g = new THREE.Group();
  addCritterBox(g, 0.18, 0.16, 0.26, 0, 0.12, 0, bodyMat);
  addCritterBox(g, 0.15, 0.14, 0.15, 0, 0.22, 0.12, bodyMat);
  addCritterBox(g, 0.07, 0.07, 0.07, 0, 0.13, -0.15, bodyMat, false);
  addCritterBox(g, 0.025, 0.025, 0.02, -0.045, 0.24, 0.195, darkMat, false);
  addCritterBox(g, 0.025, 0.025, 0.02, 0.045, 0.24, 0.195, darkMat, false);
  const earL = addCritterBox(g, 0.04, 0.15, 0.04, -0.04, 0.35, 0.09, earAccentMat);
  const earR = addCritterBox(g, 0.04, 0.15, 0.04, 0.04, 0.35, 0.09, earAccentMat);
  return { group: g, earL, earR };
}

function buildKoiRig(
  bodyMat: THREE.Material,
  finMat: THREE.Material,
): { group: THREE.Group; tail: THREE.Mesh } {
  const g = new THREE.Group();
  addCritterBox(g, 0.12, 0.08, 0.28, 0, 0, 0.02, bodyMat, false);
  addCritterBox(g, 0.14, 0.04, 0.1, 0, 0.02, 0.04, finMat, false);
  const tail = addCritterBox(g, 0.04, 0.09, 0.12, 0, 0, -0.16, finMat, false);
  return { group: g, tail };
}

function buildWingedCritterRig(
  bodyMat: THREE.Material,
  wingMat: THREE.Material,
  isBird: boolean,
): { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh } {
  const g = new THREE.Group();
  if (isBird) {
    addCritterBox(g, 0.09, 0.08, 0.2, 0, 0, 0, bodyMat, false);
    const wingL = addCritterBox(g, 0.22, 0.02, 0.1, -0.14, 0.02, 0, wingMat, false);
    const wingR = addCritterBox(g, 0.22, 0.02, 0.1, 0.14, 0.02, 0, wingMat, false);
    return { group: g, wingL, wingR };
  }
  addCritterBox(g, 0.03, 0.03, 0.12, 0, 0, 0, bodyMat, false);
  const wingL = addCritterBox(g, 0.14, 0.012, 0.12, -0.08, 0.01, 0, wingMat, false);
  const wingR = addCritterBox(g, 0.14, 0.012, 0.12, 0.08, 0.01, 0, wingMat, false);
  return { group: g, wingL, wingR };
}

/**
 * Builds animated outdoor wildlife (dogs, cats, hopping rabbits, pond koi fish, birds,
 * butterflies) plus fountain water spray droplets for the expanded campus grounds.
 */
export function buildOutdoorLife(params: {
  gridW: number;
  gridD: number;
  groundY: number;
  palette: OfficePalette;
}): OutdoorLifeHandle {
  const { gridW, gridD, groundY, palette } = params;
  const root = new THREE.Group();
  root.name = "OutdoorLifeRoot";

  const shibaMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-animal-shiba"), roughness: 0.78 });
  const creamMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-animal-cream"), roughness: 0.82 });
  const koiMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-animal-koi"), roughness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-accessory-dark"), roughness: 0.7 });
  const sakuraMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-sakura-blossom"), roughness: 0.72 });
  const skyWingMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-palette-sky"), roughness: 0.65 });
  const goldMat = new THREE.MeshStandardMaterial({ color: palette.getColor("--office-blossom-gold"), roughness: 0.65 });
  const waterDropMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-water-pond"),
    transparent: true,
    opacity: 0.82,
    roughness: 0.15,
  });

  // 1. Fountain water spray droplets arching out of the central South fountain
  const [fx, fz] = getCampusFountainCenter(gridW, gridD);
  const droplets: FountainDroplet[] = [];
  const dropGeo = new THREE.BoxGeometry(0.08, 0.14, 0.08);
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(dropGeo, waterDropMat);
    root.add(mesh);
    droplets.push({
      mesh,
      angle: (i / 24) * Math.PI * 2 + (i % 3) * 0.2,
      speedXZ: 0.65 + (i % 4) * 0.14,
      speedY: 2.3 + (i % 3) * 0.35,
      phase: (i * 0.17) % 1,
    });
  }

  // 2. Two patrolling dogs + two strolling cats on the lawns & pathways
  const walkingCritters: WalkingCritter[] = [];

  const dogSpecs: Array<{
    id: string;
    name: string;
    fur: THREE.Material;
    waypoints: PatrolWaypoint[];
    speed: number;
    phase: number;
  }> = [
    {
      id: "outdoor-dog-0",
      name: "Mochi",
      fur: shibaMat,
      waypoints: [
        { x: gridW / 2 - 7.5, z: gridD + 3.5 },
        { x: gridW / 2 - 11.5, z: gridD + 11.5 },
        { x: gridW / 2 - 5.5, z: gridD + 15.0 },
        { x: gridW / 2 - 4.5, z: gridD + 7.5 },
      ],
      speed: 1.35,
      phase: 0,
    },
    {
      id: "outdoor-dog-1",
      name: "Biscuit",
      fur: goldMat,
      waypoints: [
        { x: gridW / 2 + 6.5, z: gridD + 4.0 },
        { x: gridW / 2 + 12.5, z: gridD + 11.0 },
        { x: gridW / 2 + 7.0, z: gridD + 15.2 },
        { x: gridW / 2 + 4.2, z: gridD + 8.5 },
      ],
      speed: 1.25,
      phase: 1.6,
    },
  ];

  for (const spec of dogSpecs) {
    const rig = buildDogRig(spec.fur, creamMat, darkMat);
    rig.group.position.set(spec.waypoints[0]!.x, groundY + 0.02, spec.waypoints[0]!.z);
    root.add(rig.group);
    walkingCritters.push({
      id: spec.id,
      name: spec.name,
      kind: "dog",
      group: rig.group,
      legs: rig.legs,
      tail: rig.tail,
      waypoints: spec.waypoints,
      waypointIndex: 1,
      pauseTimer: 0,
      happyTimer: 0,
      happyFaceTarget: null,
      followingPlayer: false,
      speed: spec.speed,
      baseY: groundY + 0.02,
      phase: spec.phase,
    });
  }

  const pond = getCampusPondBounds(gridW, gridD);
  const catSpecs: Array<{
    id: string;
    name: string;
    fur: THREE.Material;
    waypoints: PatrolWaypoint[];
    speed: number;
    phase: number;
  }> = [
    {
      id: "outdoor-cat-0",
      name: "Marmalade",
      fur: koiMat,
      waypoints: [
        { x: pond.cx + pond.halfW + 1.4, z: pond.cz - 1.0 },
        { x: pond.cx + pond.halfW + 1.8, z: pond.cz + 3.2 },
        { x: pond.cx - 1.5, z: pond.cz + pond.halfD + 1.6 },
        { x: -5.8, z: gridD + 2.2 },
      ],
      speed: 0.85,
      phase: 0.7,
    },
    {
      id: "outdoor-cat-1",
      name: "Shadow",
      fur: darkMat,
      waypoints: [
        { x: gridW + 5.8, z: gridD - 2.0 },
        { x: gridW + 7.5, z: gridD + 2.2 },
        { x: gridW + 4.8, z: gridD + 9.2 },
        { x: gridW + 5.2, z: gridD + 1.5 },
      ],
      speed: 0.8,
      phase: 2.2,
    },
  ];

  for (const spec of catSpecs) {
    const rig = buildCatRig(spec.fur, creamMat, darkMat);
    rig.group.position.set(spec.waypoints[0]!.x, groundY + 0.02, spec.waypoints[0]!.z);
    root.add(rig.group);
    walkingCritters.push({
      id: spec.id,
      name: spec.name,
      kind: "cat",
      group: rig.group,
      legs: rig.legs,
      tail: rig.tail,
      waypoints: spec.waypoints,
      waypointIndex: 1,
      pauseTimer: 0,
      happyTimer: 0,
      happyFaceTarget: null,
      followingPlayer: false,
      speed: spec.speed,
      baseY: groundY + 0.02,
      phase: spec.phase,
    });
  }

  // 3. Four hopping rabbits in North & West meadows
  const rabbits: HoppingRabbit[] = [];
  const rabbitCoords = [
    [-11.0, 6.0, 2.2, 1.8, 0],
    [-12.5, -8.5, 2.4, 2.0, 1.7],
    [gridW * 0.35, -9.5, 2.8, 1.6, 3.1],
    [gridW + 10.5, -7.5, 2.2, 2.1, 4.4],
  ] as const;
  rabbitCoords.forEach(([ox, oz, rx, rz, phase], rIdx) => {
    const rig = buildRabbitRig(creamMat, sakuraMat, darkMat);
    rig.group.position.set(ox, groundY + 0.02, oz);
    root.add(rig.group);
    rabbits.push({
      id: `outdoor-rabbit-${rIdx}`,
      name: "Garden Rabbit",
      group: rig.group,
      earL: rig.earL,
      earR: rig.earR,
      originX: ox,
      originZ: oz,
      radiusX: rx,
      radiusZ: rz,
      happyTimer: 0,
      happyFaceTarget: null,
      baseY: groundY + 0.02,
      phase,
      speed: 0.48,
    });
  });

  // 4. Five Koi fish swimming smoothly in the West Koi Pond
  const koiFish: SwimmingKoi[] = [];
  for (let i = 0; i < 5; i++) {
    const useCream = i % 2 === 1;
    const rig = buildKoiRig(useCream ? creamMat : koiMat, useCream ? koiMat : creamMat);
    rig.group.position.set(pond.cx, groundY + 0.07, pond.cz);
    root.add(rig.group);
    koiFish.push({
      group: rig.group,
      tail: rig.tail,
      cx: pond.cx,
      cz: pond.cz,
      rx: 1.35 + (i % 3) * 0.65,
      rz: 1.0 + (i % 2) * 0.65,
      baseY: groundY + 0.065,
      phase: i * 1.25,
      speed: 0.55 + (i % 3) * 0.14,
    });
  }

  // 5. Sky songbirds & meadow butterflies
  const wingedCritters: FlyingWingedCritter[] = [];
  for (let i = 0; i < 5; i++) {
    const rig = buildWingedCritterRig(i % 2 === 0 ? skyWingMat : creamMat, darkMat, true);
    root.add(rig.group);
    wingedCritters.push({
      group: rig.group,
      wingL: rig.wingL,
      wingR: rig.wingR,
      cx: gridW / 2 + (i - 2) * 8,
      cz: gridD + 11 + (i % 2) * 4,
      rx: 6.5 + i * 1.2,
      rz: 4.5 + i * 0.8,
      baseY: groundY + 9.2 + (i % 3) * 1.0,
      phase: i * 1.4,
      speed: 0.42 + i * 0.05,
      flapRate: 9.0,
      hideInBadWeather: false,
    });
  }

  for (const [bx, bz, phase] of [
    [-14.0, -6.5, 0.2],
    [gridW + 13.5, -6.5, 1.3],
    [pond.cx - 5.2, pond.cz + 3.2, 2.4],
    [fx - 5.8, fz + 2.5, 3.5],
    [fx + 5.8, fz + 2.5, 4.6],
    [gridW / 2 - 4.0, gridD + 2.8, 5.7],
  ] as const) {
    const rig = buildWingedCritterRig(darkMat, phase % 2 < 1 ? sakuraMat : goldMat, false);
    root.add(rig.group);
    wingedCritters.push({
      group: rig.group,
      wingL: rig.wingL,
      wingR: rig.wingR,
      cx: bx,
      cz: bz,
      rx: 1.15,
      rz: 0.85,
      baseY: groundY + 0.9,
      phase,
      speed: 1.1,
      flapRate: 14.0,
      hideInBadWeather: true,
    });
  }

  // 6. Interactive proxy triggers for Koi Pond & Fountain + pooled voxel burst particles
  const pondInteractableId = "outdoor-koi-pond";
  const fountainInteractableId = "outdoor-fountain";
  const pondHitGeo = new THREE.BoxGeometry(pond.halfW * 2, 0.35, pond.halfD * 2);
  const hiddenTriggerMat = new THREE.MeshBasicMaterial({ visible: false });
  const pondHitMesh = new THREE.Mesh(pondHitGeo, hiddenTriggerMat);
  pondHitMesh.position.set(pond.cx, groundY + 0.2, pond.cz);
  root.add(pondHitMesh);

  const fountainHitMesh = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 3.2), hiddenTriggerMat);
  fountainHitMesh.position.set(fx, groundY + 0.8, fz);
  root.add(fountainHitMesh);

  let koiFeedTimer = 0;
  let koiFeedTarget = { x: pond.cx, z: pond.cz };

  const MAX_BURST_PARTICLES = 24;
  const burstGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  const burstMats = [sakuraMat, goldMat, waterDropMat];
  const burstPool: BurstParticle[] = [];
  for (let i = 0; i < MAX_BURST_PARTICLES; i++) {
    const mesh = new THREE.Mesh(burstGeo, burstMats[i % burstMats.length]!);
    mesh.position.set(fx, groundY - 2, fz);
    mesh.visible = false;
    root.add(mesh);
    burstPool.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
  }

  // 7. Ambient night fireflies (around koi pond & south lawns) + daytime drifting sakura petals
  const fireflyMat = new THREE.MeshStandardMaterial({
    color: palette.getColor("--office-blossom-gold"),
    emissive: palette.getColor("--office-blossom-gold"),
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  const fireflyGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  const fireflies: Array<{ mesh: THREE.Mesh; ax: number; az: number; phase: number }> = [];
  for (let i = 0; i < 16; i++) {
    const mesh = new THREE.Mesh(fireflyGeo, fireflyMat);
    const aroundPond = i < 8;
    const ax = aroundPond ? pond.cx + ((i % 4) - 1.5) * 1.9 : gridW / 2 + ((i - 12) * 3.1);
    const az = aroundPond ? pond.cz + (i < 4 ? -2.2 : 2.4) : gridD + 7.5 + (i % 3) * 3.5;
    mesh.position.set(ax, groundY + 1.1, az);
    mesh.visible = false;
    root.add(mesh);
    fireflies.push({ mesh, ax, az, phase: i * 0.85 });
  }

  const petalGeo = new THREE.BoxGeometry(0.09, 0.02, 0.07);
  const sakuraPetals: Array<{ mesh: THREE.Mesh; ox: number; oz: number; phase: number; fallSpeed: number }> = [];
  const petalCenters: ReadonlyArray<[number, number]> = [
    [-4.5, gridD + 4.5],
    [gridW + 4.5, gridD + 4.5],
    [gridW / 2 - 6.5, gridD + 8.5],
    [gridW / 2 + 6.5, gridD + 8.5],
  ];
  for (let i = 0; i < 20; i++) {
    const mesh = new THREE.Mesh(petalGeo, sakuraMat);
    const [ox, oz] = petalCenters[i % petalCenters.length]!;
    mesh.position.set(ox, groundY + 2.8, oz);
    mesh.visible = false;
    root.add(mesh);
    sakuraPetals.push({
      mesh,
      ox,
      oz,
      phase: (i * 0.23) % 1,
      fallSpeed: 0.48 + (i % 3) * 0.14,
    });
  }

  const spawnBurst = (bx: number, by: number, bz: number, count: number) => {
    let spawned = 0;
    for (const p of burstPool) {
      if (spawned >= count) break;
      if (p.life > 0 && spawned < count / 2) continue;
      const angle = (spawned / Math.max(1, count)) * Math.PI * 2;
      const spread = 0.45 + (spawned % 3) * 0.22;
      p.mesh.position.set(bx, by, bz);
      p.mesh.visible = true;
      p.mesh.scale.setScalar(1);
      p.vx = Math.cos(angle) * spread;
      p.vy = 1.45 + (spawned % 3) * 0.35;
      p.vz = Math.sin(angle) * spread;
      p.maxLife = 1.15;
      p.life = 1.15;
      spawned += 1;
    }
  };

  const clampOutdoorStep = (x: number, z: number): { x: number; z: number } => {
    let nx = Math.max(-21, Math.min(gridW + 21, x));
    let nz = Math.max(-21, Math.min(gridD + 21, z));
    if (nx > -1.0 && nx < gridW + 1.0 && nz > -1.0 && nz < gridD + 1.0) {
      if (nz >= gridD - 2) {
        nz = gridD + 1.1;
      } else if (nx < gridW / 2) {
        nx = -1.1;
      } else {
        nx = gridW + 1.1;
      }
    }
    if (
      nx > pond.cx - pond.halfW - 0.8 &&
      nx < pond.cx + pond.halfW + 0.8 &&
      nz > pond.cz - pond.halfD - 0.8 &&
      nz < pond.cz + pond.halfD + 0.8
    ) {
      nx = pond.cx + pond.halfW + 0.9;
    }
    return { x: nx, z: nz };
  };

  const update = (
    dt: number,
    elapsedSec: number,
    weather: WeatherKind,
    reducedMotion: boolean,
    playerPos?: { x: number; z: number; isIndoors: boolean },
    isNight = false,
  ) => {
    const motionScale = reducedMotion ? 0.2 : 1;
    const stepDt = dt * motionScale;

    if (koiFeedTimer > 0) {
      koiFeedTimer = Math.max(0, koiFeedTimer - dt);
    }

    // Night fireflies (clear nights) & drifting sakura petals (clear day/sunset)
    const showFireflies = isNight && weather === "clear";
    for (const ff of fireflies) {
      ff.mesh.visible = showFireflies;
      if (!showFireflies) continue;
      const t = elapsedSec * 1.4 * motionScale + ff.phase;
      ff.mesh.position.set(
        ff.ax + Math.sin(t) * 1.15,
        groundY + 0.95 + Math.sin(t * 1.8 + ff.phase) * 0.45,
        ff.az + Math.cos(t * 0.9) * 1.05,
      );
      const pulse = 0.65 + 0.55 * Math.sin(elapsedSec * 4.2 + ff.phase * 2);
      ff.mesh.scale.setScalar(pulse);
    }

    const showPetals = !isNight && weather === "clear";
    for (const petal of sakuraPetals) {
      petal.mesh.visible = showPetals;
      if (!showPetals) continue;
      const cycle = (elapsedSec * 0.16 * petal.fallSpeed * motionScale + petal.phase) % 1;
      const py = groundY + 4.4 - cycle * 4.1;
      const swirl = cycle * Math.PI * 3 + petal.phase * 6.28;
      petal.mesh.position.set(
        petal.ox + Math.cos(swirl) * (0.85 + cycle * 1.2),
        py,
        petal.oz + Math.sin(swirl) * (0.85 + cycle * 1.2),
      );
      petal.mesh.rotation.set(swirl, swirl * 0.6, Math.sin(swirl) * 0.4);
    }

    // Burst heart/food/coin sparkles
    for (const p of burstPool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.life = 0;
        p.mesh.visible = false;
        p.mesh.position.set(fx, groundY - 2, fz);
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 1.8 * dt;
      const ratio = Math.max(0.15, p.life / p.maxLife);
      p.mesh.scale.setScalar(ratio);
      p.mesh.rotation.y += 3.5 * dt;
    }

    // Arching fountain spray droplets
    for (const drop of droplets) {
      const cycle = (elapsedSec * 0.95 * motionScale + drop.phase) % 1;
      const t = cycle * 0.95;
      const dist = drop.speedXZ * t;
      const dy = drop.speedY * t - 2.65 * t * t;
      drop.mesh.position.set(
        fx + Math.cos(drop.angle) * dist,
        groundY + 1.7 + dy,
        fz + Math.sin(drop.angle) * dist,
      );
      drop.mesh.visible = groundY + 1.7 + dy >= groundY + 0.28;
    }

    // Dogs & Cats patrol cleanly between lawn waypoints (or follow / greet player)
    for (const critter of walkingCritters) {
      if (critter.happyTimer > 0) {
        critter.happyTimer = Math.max(0, critter.happyTimer - dt);
        if (critter.happyFaceTarget) {
          const fdx = critter.happyFaceTarget.x - critter.group.position.x;
          const fdz = critter.happyFaceTarget.z - critter.group.position.z;
          if (Math.hypot(fdx, fdz) > 0.08) {
            critter.group.rotation.y = Math.atan2(fdx, fdz);
          }
        }
        critter.group.position.y =
          critter.baseY + Math.abs(Math.sin(elapsedSec * 12 + critter.phase)) * 0.12 * motionScale;
        critter.tail.rotation.y = Math.sin(elapsedSec * 16 + critter.phase) * 0.62;
        for (const leg of critter.legs) leg.rotation.x = 0;
        continue;
      }

      if (critter.kind === "dog" && critter.followingPlayer) {
        const dest =
          playerPos && !playerPos.isIndoors
            ? clampOutdoorStep(playerPos.x, playerPos.z)
            : { x: gridW / 2 - 2.4, z: gridD + 2.6 };
        const dx = dest.x - critter.group.position.x;
        const dz = dest.z - critter.group.position.z;
        const dist = Math.hypot(dx, dz);
        const stopRadius = playerPos && !playerPos.isIndoors ? 2.1 : 0.45;
        if (dist > stopRadius) {
          const move = Math.min(dist - stopRadius, critter.speed * 1.65 * stepDt);
          const next = clampOutdoorStep(
            critter.group.position.x + (dx / dist) * move,
            critter.group.position.z + (dz / dist) * move,
          );
          critter.group.position.set(next.x, critter.baseY, next.z);
          critter.group.rotation.y = Math.atan2(dx, dz);
          const stride = elapsedSec * 12 + critter.phase;
          critter.legs[0]!.rotation.x = Math.sin(stride) * 0.5;
          critter.legs[1]!.rotation.x = -Math.sin(stride) * 0.5;
          critter.legs[2]!.rotation.x = -Math.sin(stride) * 0.5;
          critter.legs[3]!.rotation.x = Math.sin(stride) * 0.5;
          critter.tail.rotation.y = Math.sin(elapsedSec * 12 + critter.phase) * 0.5;
        } else {
          if (playerPos) {
            critter.group.rotation.y = Math.atan2(
              playerPos.x - critter.group.position.x,
              playerPos.z - critter.group.position.z,
            );
          }
          critter.group.position.y = critter.baseY;
          critter.tail.rotation.y = Math.sin(elapsedSec * 11 + critter.phase) * 0.5;
          for (const leg of critter.legs) leg.rotation.x = 0;
        }
        continue;
      }

      if (critter.pauseTimer > 0) {
        critter.pauseTimer -= stepDt;
        critter.group.position.y = critter.baseY;
        critter.tail.rotation.y = Math.sin(elapsedSec * (critter.kind === "dog" ? 10 : 3.5)) * 0.45;
        for (const leg of critter.legs) leg.rotation.x = 0;
        continue;
      }

      const target = critter.waypoints[critter.waypointIndex]!;
      const dx = target.x - critter.group.position.x;
      const dz = target.z - critter.group.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.18) {
        critter.waypointIndex = (critter.waypointIndex + 1) % critter.waypoints.length;
        critter.pauseTimer = critter.kind === "dog" ? 2.2 : 3.4;
        continue;
      }

      const move = Math.min(dist, critter.speed * stepDt);
      critter.group.position.x += (dx / dist) * move;
      critter.group.position.z += (dz / dist) * move;
      critter.group.position.y = critter.baseY;
      critter.group.rotation.y = Math.atan2(dx, dz);

      const stride = elapsedSec * 9.5 + critter.phase;
      critter.legs[0]!.rotation.x = Math.sin(stride) * 0.45;
      critter.legs[1]!.rotation.x = -Math.sin(stride) * 0.45;
      critter.legs[2]!.rotation.x = -Math.sin(stride) * 0.45;
      critter.legs[3]!.rotation.x = Math.sin(stride) * 0.45;
      critter.tail.rotation.y = Math.sin(elapsedSec * 7.5 + critter.phase) * 0.38;
    }

    // Hopping rabbits
    for (const rabbit of rabbits) {
      if (rabbit.happyTimer > 0) {
        rabbit.happyTimer = Math.max(0, rabbit.happyTimer - dt);
        const hopPhase = (elapsedSec * 3.8 * motionScale + rabbit.phase) % 1;
        const hopArc = Math.sin(hopPhase * Math.PI) * 0.28;
        rabbit.group.position.y = rabbit.baseY + hopArc;
        if (rabbit.happyFaceTarget) {
          rabbit.group.rotation.y = Math.atan2(
            rabbit.happyFaceTarget.x - rabbit.group.position.x,
            rabbit.happyFaceTarget.z - rabbit.group.position.z,
          );
        }
        rabbit.earL.rotation.x = -0.1 + Math.sin(elapsedSec * 14 + rabbit.phase) * 0.25;
        rabbit.earR.rotation.x = -0.1 - Math.sin(elapsedSec * 14 + rabbit.phase) * 0.25;
        continue;
      }

      const angle = elapsedSec * rabbit.speed * motionScale + rabbit.phase;
      const nx = rabbit.originX + Math.cos(angle) * rabbit.radiusX;
      const nz = rabbit.originZ + Math.sin(angle) * rabbit.radiusZ;
      const tangentX = -Math.sin(angle) * rabbit.radiusX;
      const tangentZ = Math.cos(angle) * rabbit.radiusZ;
      const hopPhase = (elapsedSec * 2.2 * motionScale + rabbit.phase) % 1;
      const hopArc = Math.sin(hopPhase * Math.PI) * 0.24;

      rabbit.group.position.set(nx, rabbit.baseY + hopArc, nz);
      rabbit.group.rotation.y = Math.atan2(tangentX, tangentZ);
      rabbit.earL.rotation.x = -0.15 + Math.sin(elapsedSec * 6 + rabbit.phase) * 0.14;
      rabbit.earR.rotation.x = -0.15 - Math.sin(elapsedSec * 6 + rabbit.phase) * 0.14;
    }

    // Swimming pond koi (gather toward food spot when fed)
    for (let i = 0; i < koiFish.length; i++) {
      const koi = koiFish[i]!;
      if (koiFeedTimer > 0) {
        const orbitAngle = elapsedSec * 1.45 * motionScale + i * 1.25;
        const goalX = koiFeedTarget.x + Math.cos(orbitAngle) * 0.65;
        const goalZ = koiFeedTarget.z + Math.sin(orbitAngle) * 0.55;
        const dx = goalX - koi.group.position.x;
        const dz = goalZ - koi.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.04) {
          const step = Math.min(d, 1.85 * stepDt);
          koi.group.position.x += (dx / d) * step;
          koi.group.position.z += (dz / d) * step;
          koi.group.position.y = koi.baseY;
          koi.group.rotation.y = Math.atan2(dx, dz);
        }
        koi.tail.rotation.y = Math.sin(elapsedSec * 12 + koi.phase) * 0.55;
        continue;
      }

      const theta = elapsedSec * koi.speed * motionScale + koi.phase;
      const nx = koi.cx + Math.cos(theta) * koi.rx;
      const nz = koi.cz + Math.sin(theta * 2) * (koi.rz * 0.55);
      const vx = -Math.sin(theta) * koi.rx;
      const vz = Math.cos(theta * 2) * (koi.rz * 1.1);
      koi.group.position.set(nx, koi.baseY, nz);
      koi.group.rotation.y = Math.atan2(vx, vz);
      koi.tail.rotation.y = Math.sin(elapsedSec * 8.5 + koi.phase) * 0.45;
    }

    // Birds & butterflies
    for (const flyer of wingedCritters) {
      const visible = !flyer.hideInBadWeather || weather === "clear";
      flyer.group.visible = visible;
      if (!visible) continue;
      const theta = elapsedSec * flyer.speed * motionScale + flyer.phase;
      const nx = flyer.cx + Math.cos(theta) * flyer.rx;
      const nz = flyer.cz + Math.sin(theta) * flyer.rz;
      const ny = flyer.baseY + Math.sin(theta * 2.5 + flyer.phase) * 0.35;
      flyer.group.position.set(nx, ny, nz);
      flyer.group.rotation.y = Math.atan2(-Math.sin(theta) * flyer.rx, Math.cos(theta) * flyer.rz);
      const flap = Math.sin(elapsedSec * flyer.flapRate * motionScale + flyer.phase) * 0.55;
      flyer.wingL.rotation.z = flap;
      flyer.wingR.rotation.z = -flap;
    }
  };

  const findNearestInteractable = (px: number, pz: number): OutdoorInteractableTarget | null => {
    let best: OutdoorInteractableTarget | null = null;
    let bestDist = Infinity;

    const consider = (candidate: OutdoorInteractableTarget) => {
      const d = Math.hypot(px - candidate.x, pz - candidate.z);
      if (d <= candidate.interactionRadius && d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    };

    for (const critter of walkingCritters) {
      consider({
        id: critter.id,
        kind: critter.kind === "dog" ? "outdoor_dog" : "outdoor_cat",
        label: critter.name,
        x: critter.group.position.x,
        z: critter.group.position.z,
        interactionRadius: 2.3,
        following: critter.kind === "dog" ? critter.followingPlayer : undefined,
      });
    }

    for (const rabbit of rabbits) {
      consider({
        id: rabbit.id,
        kind: "outdoor_rabbit",
        label: rabbit.name,
        x: rabbit.group.position.x,
        z: rabbit.group.position.z,
        interactionRadius: 2.2,
      });
    }

    consider({
      id: pondInteractableId,
      kind: "outdoor_koi_pond",
      label: "Koi Pond",
      x: pond.cx,
      z: pond.cz,
      interactionRadius: Math.max(pond.halfW, pond.halfD) + 2.0,
    });

    consider({
      id: fountainInteractableId,
      kind: "outdoor_fountain",
      label: "Courtyard Fountain",
      x: fx,
      z: fz,
      interactionRadius: 3.4,
    });

    return best;
  };

  const interact = (
    id: string,
    targetPlayerPos: { x: number; z: number },
  ): OutdoorInteractionResult | null => {
    const critter = walkingCritters.find((c) => c.id === id);
    if (critter) {
      critter.happyTimer = 2.6;
      critter.happyFaceTarget = { x: targetPlayerPos.x, z: targetPlayerPos.z };
      spawnBurst(
        critter.group.position.x,
        critter.baseY + 0.65,
        critter.group.position.z,
        8,
      );
      if (critter.kind === "dog") {
        critter.followingPlayer = !critter.followingPlayer;
        return {
          kind: "outdoor_dog",
          label: critter.name,
          x: critter.group.position.x,
          z: critter.group.position.z,
          pose: "petting",
          feedbackKind: critter.followingPlayer ? "pet_dog_follow" : "pet_dog_stay",
        };
      }
      return {
        kind: "outdoor_cat",
        label: critter.name,
        x: critter.group.position.x,
        z: critter.group.position.z,
        pose: "petting",
        feedbackKind: "pet_cat",
      };
    }

    const rabbit = rabbits.find((r) => r.id === id);
    if (rabbit) {
      rabbit.happyTimer = 2.6;
      rabbit.happyFaceTarget = { x: targetPlayerPos.x, z: targetPlayerPos.z };
      spawnBurst(rabbit.group.position.x, rabbit.baseY + 0.5, rabbit.group.position.z, 7);
      return {
        kind: "outdoor_rabbit",
        label: rabbit.name,
        x: rabbit.group.position.x,
        z: rabbit.group.position.z,
        pose: "petting",
        feedbackKind: "pet_rabbit",
      };
    }

    if (id === pondInteractableId) {
      koiFeedTimer = 7.0;
      const clampedX = Math.max(
        pond.cx - pond.halfW + 0.85,
        Math.min(pond.cx + pond.halfW - 0.85, targetPlayerPos.x),
      );
      const clampedZ = Math.max(
        pond.cz - pond.halfD + 0.85,
        Math.min(pond.cz + pond.halfD - 0.85, targetPlayerPos.z),
      );
      koiFeedTarget = { x: clampedX, z: clampedZ };
      spawnBurst(clampedX, groundY + 0.35, clampedZ, 10);
      return {
        kind: "outdoor_koi_pond",
        label: "Koi Pond",
        x: clampedX,
        z: clampedZ,
        pose: "feeding",
        feedbackKind: "feed_koi",
      };
    }

    if (id === fountainInteractableId) {
      spawnBurst(fx, groundY + 1.25, fz, 12);
      return {
        kind: "outdoor_fountain",
        label: "Courtyard Fountain",
        x: fx,
        z: fz,
        pose: "feeding",
        feedbackKind: "toss_coin",
      };
    }

    return null;
  };

  const getClickableEntries = (): Array<{ id: string; object: THREE.Object3D }> => [
    ...walkingCritters.map((c) => ({ id: c.id, object: c.group })),
    ...rabbits.map((r) => ({ id: r.id, object: r.group })),
    { id: pondInteractableId, object: pondHitMesh },
    { id: fountainInteractableId, object: fountainHitMesh },
  ];

  return { root, update, findNearestInteractable, interact, getClickableEntries };
}

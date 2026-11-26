import * as THREE from "three";
import { REDUCED_MOTION_CHAR_AMP } from "../model/constants";
import type {
  AgentVisualState,
  AvatarHairColor,
  AvatarOutfit,
  AvatarSkinConfig,
  AvatarSkinTone,
  CharacterActionPose,
  OfficeColorToken,
} from "../model/types";
import type { OfficePalette } from "./palette";

const OUTFIT_TOKENS: Record<AvatarOutfit, OfficeColorToken> = {
  shirt: "--office-outfit-shirt",
  hoodie: "--office-outfit-hoodie",
  suit: "--office-outfit-suit",
  tshirt: "--office-outfit-tshirt",
  apron: "--office-outfit-apron",
};

const SKIN_TONE_TOKENS: Record<AvatarSkinTone, OfficeColorToken> = {
  tone1: "--office-skin-tone1",
  tone2: "--office-skin-tone2",
  tone3: "--office-skin-tone3",
  tone4: "--office-skin-tone4",
  tone5: "--office-skin-tone5",
};

const HAIR_COLOR_TOKENS: Record<AvatarHairColor, OfficeColorToken> = {
  black: "--office-hair-black",
  brown: "--office-hair-brown",
  blonde: "--office-hair-blonde",
  red: "--office-hair-red",
  gray: "--office-hair-gray",
  blue: "--office-hair-blue",
};

export interface VoxelCharacterRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  heldItemMount: THREE.Group;
  statusOrb: THREE.Mesh;
}

function createFaceTexture(
  skinCss: string,
  eyeCss: string,
  whiteCss: string,
  hairCss: string,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = skinCss || "tan";
  ctx.fillRect(0, 0, 64, 64);

  // Subtle hair fringe across forehead
  ctx.fillStyle = hairCss || "black";
  ctx.fillRect(0, 0, 64, 14);
  ctx.fillRect(0, 14, 10, 8);
  ctx.fillRect(54, 14, 10, 8);

  // Classic Minecraft-style 2x2 eyes
  ctx.fillStyle = whiteCss || "white";
  ctx.fillRect(14, 28, 12, 8);
  ctx.fillRect(38, 28, 12, 8);
  ctx.fillStyle = eyeCss || "black";
  ctx.fillRect(20, 28, 6, 8);
  ctx.fillRect(38, 28, 6, 8);

  // Subtle mouth
  ctx.fillStyle = hairCss || "black";
  ctx.fillRect(26, 48, 12, 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createVoxelCharacter(
  skin: AvatarSkinConfig,
  palette: OfficePalette,
  options: { name: string; isPlayer?: boolean },
): VoxelCharacterRig {
  const root = new THREE.Group();
  root.name = options.name;

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const skinColor = palette.getColor(SKIN_TONE_TOKENS[skin.skinTone]);
  const hairColor = palette.getColor(HAIR_COLOR_TOKENS[skin.hairColor]);
  const outfitColor = palette.getColor(OUTFIT_TOKENS[skin.outfit]);
  const pantsColor = palette.getColor("--office-pants-default");
  const shoesColor = palette.getColor("--office-shoes-default");
  const darkAccColor = palette.getColor("--office-accessory-dark");
  const accentColor = palette.getColor("--office-accessory-accent");
  const hardhatColor = palette.getColor("--office-accessory-hardhat");

  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.75 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 });
  const outfitMat = new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.8 });
  const shoesMat = new THREE.MeshStandardMaterial({ color: shoesColor, roughness: 0.65 });

  // Legs (Minecraft proportions scaled to ~1.55m office character height)
  const legGeo = new THREE.BoxGeometry(0.18, 0.5, 0.18);
  const shoeGeo = new THREE.BoxGeometry(0.19, 0.1, 0.21);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.1, 0.5, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, pantsMat);
  leftLegMesh.position.y = -0.25;
  leftLegMesh.castShadow = true;
  const leftShoe = new THREE.Mesh(shoeGeo, shoesMat);
  leftShoe.position.set(0, -0.45, 0.01);
  leftLeg.add(leftLegMesh, leftShoe);
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.1, 0.5, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, pantsMat);
  rightLegMesh.position.y = -0.25;
  rightLegMesh.castShadow = true;
  const rightShoe = new THREE.Mesh(shoeGeo, shoesMat);
  rightShoe.position.set(0, -0.45, 0.01);
  rightLeg.add(rightLegMesh, rightShoe);
  bodyPivot.add(rightLeg);

  // Torso (Box #2) + Body Layer (2-layer Minecraft accessory)
  const torsoGeo = new THREE.BoxGeometry(0.38, 0.54, 0.22);
  const torsoMesh = new THREE.Mesh(torsoGeo, outfitMat);
  torsoMesh.position.set(0, 0.77, 0);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  bodyPivot.add(torsoMesh);

  if (skin.outfit === "suit") {
    const tieMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.03), tieMat);
    tie.position.set(0, 0.8, 0.12);
    bodyPivot.add(tie);
  } else if (skin.outfit === "hoodie") {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.03), outfitMat);
    pocket.position.set(0, 0.62, 0.12);
    bodyPivot.add(pocket);
  } else if (skin.outfit === "apron") {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.06, 0.24),
      new THREE.MeshStandardMaterial({ color: darkAccColor, roughness: 0.7 }),
    );
    strap.position.set(0, 0.72, 0);
    bodyPivot.add(strap);
  }

  // Arms (Box #3 & #4)
  const armGeo = new THREE.BoxGeometry(0.14, 0.5, 0.16);
  const handGeo = new THREE.BoxGeometry(0.13, 0.12, 0.15);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.27, 1.0, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, outfitMat);
  leftArmMesh.position.y = -0.22;
  leftArmMesh.castShadow = true;
  const leftHand = new THREE.Mesh(handGeo, skinMat);
  leftHand.position.y = -0.44;
  leftArm.add(leftArmMesh, leftHand);
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.27, 1.0, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, outfitMat);
  rightArmMesh.position.y = -0.22;
  rightArmMesh.castShadow = true;
  const rightHand = new THREE.Mesh(handGeo, skinMat);
  rightHand.position.y = -0.44;
  const heldItemMount = new THREE.Group();
  heldItemMount.position.set(0, -0.48, 0.14);
  rightArm.add(rightArmMesh, rightHand, heldItemMount);
  bodyPivot.add(rightArm);

  // Head (Box #5 + Head Layer)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.04, 0);
  bodyPivot.add(headGroup);

  const faceTexture = createFaceTexture(
    palette.getCss(SKIN_TONE_TOKENS[skin.skinTone]),
    palette.getCss("--office-accessory-dark"),
    palette.getCss("--office-outfit-shirt"),
    palette.getCss(HAIR_COLOR_TOKENS[skin.hairColor]),
  );
  const faceMat = faceTexture
    ? new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.7 })
    : skinMat;

  const headMaterials = [
    skinMat, // right
    skinMat, // left
    hairMat, // top
    skinMat, // bottom
    faceMat, // front (+Z)
    hairMat, // back (-Z)
  ];
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), headMaterials);
  headMesh.position.y = 0.2;
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // 2-Layer Headwear
  const darkMat = new THREE.MeshStandardMaterial({ color: darkAccColor, roughness: 0.45 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.9,
  });

  if (skin.headwear === "sunglasses" || skin.headwear === "glasses") {
    const lensMat =
      skin.headwear === "sunglasses"
        ? darkMat
        : new THREE.MeshStandardMaterial({ color: accentColor, transparent: true, opacity: 0.45 });
    const leftLens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.03), lensMat);
    leftLens.position.set(-0.085, 0.2, 0.2);
    const rightLens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.03), lensMat);
    rightLens.position.set(0.085, 0.2, 0.2);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.03), darkMat);
    bridge.position.set(0, 0.21, 0.2);
    headGroup.add(leftLens, rightLens, bridge);
  } else if (skin.headwear === "headset") {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.08), darkMat);
    band.position.set(0, 0.41, 0);
    const leftCup = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.14), darkMat);
    leftCup.position.set(-0.21, 0.2, 0);
    const rightCup = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.14), darkMat);
    rightCup.position.set(0.21, 0.2, 0);
    const ledLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06), glowMat);
    ledLeft.position.set(-0.23, 0.2, 0);
    const ledRight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06), glowMat);
    ledRight.position.set(0.23, 0.2, 0);
    headGroup.add(band, leftCup, rightCup, ledLeft, ledRight);
  } else if (skin.headwear === "hardhat") {
    const hatMat = new THREE.MeshStandardMaterial({ color: hardhatColor, roughness: 0.4 });
    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.42), hatMat);
    dome.position.set(0, 0.41, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.1), hatMat);
    brim.position.set(0, 0.35, 0.24);
    headGroup.add(dome, brim);
  } else if (skin.headwear === "beanie") {
    const beanieMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.85 });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.14, 0.41), beanieMat);
    cap.position.set(0, 0.38, 0);
    const pom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), beanieMat);
    pom.position.set(0, 0.48, 0);
    headGroup.add(cap, pom);
  }

  // Floating status orb above head
  const statusColor = options.isPlayer
    ? palette.getColor("--office-status-healthy")
    : palette.getColor("--office-status-idle");
  const statusOrb = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.14),
    new THREE.MeshStandardMaterial({
      color: statusColor,
      emissive: statusColor,
      emissiveIntensity: 0.7,
    }),
  );
  statusOrb.position.set(0, 1.75, 0);
  statusOrb.visible = !options.isPlayer;
  root.add(statusOrb);

  return {
    root,
    bodyPivot,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    heldItemMount,
    statusOrb,
  };
}

export interface VoxelPoseOptions {
  isWalking: boolean;
  seated: boolean;
  reducedMotion: boolean;
  walkPhase?: number;
  speedRatio?: number;
  turnRate?: number;
  phaseOffset?: number;
  actionPose?: CharacterActionPose;
  actionProgress?: number;
  hasHeldItem?: boolean;
  seatBlend?: number;
}

function actionEnvelope(progress: number | undefined, rise = 0.2, fall = 0.2): number {
  if (progress === undefined) return 1;
  const p = Math.max(0, Math.min(1, progress));
  if (p < rise && rise > 0) return Math.sin((p / rise) * (Math.PI / 2));
  if (p > 1 - fall && fall > 0) return Math.sin(((1 - p) / fall) * (Math.PI / 2));
  return 1;
}

export function updateVoxelPose(
  rig: VoxelCharacterRig,
  state: AgentVisualState,
  time: number,
  options: VoxelPoseOptions,
): void {
  const { bodyPivot, headGroup, leftArm, rightArm, leftLeg, rightLeg, heldItemMount, statusOrb } = rig;
  const amp = options.reducedMotion ? REDUCED_MOTION_CHAR_AMP : 1;
  const seatBlend = Math.max(0, Math.min(1, options.seatBlend ?? (options.seated ? 1 : 0)));
  const t = time + (options.phaseOffset ?? 0);

  // Reset base transforms each frame
  let baseY = -0.26 * seatBlend;
  bodyPivot.rotation.set(0, 0, 0);
  headGroup.rotation.set(0, 0, 0);
  leftArm.rotation.set(0, 0, 0);
  rightArm.rotation.set(0, 0, 0);
  leftLeg.rotation.set(-seatBlend * (Math.PI / 2.2), 0, 0);
  rightLeg.rotation.set(-seatBlend * (Math.PI / 2.2), 0, 0);
  heldItemMount.position.set(0, -0.48, 0.14);
  heldItemMount.rotation.set(0, 0, 0);

  if (options.isWalking) {
    const phase = options.walkPhase ?? t * 8.5;
    const strideWeight = Math.min(1.25, Math.max(0.25, options.speedRatio ?? 1));
    const stride = Math.sin(phase) * 0.72 * amp * strideWeight;
    leftLeg.rotation.x = stride;
    rightLeg.rotation.x = -stride;
    leftArm.rotation.x = -stride * 0.85;
    leftArm.rotation.z = 0.06;
    if (options.hasHeldItem) {
      rightArm.rotation.x = -0.42 + stride * 0.22;
      rightArm.rotation.z = -0.05;
    } else {
      rightArm.rotation.x = stride * 0.85;
      rightArm.rotation.z = -0.06;
    }
    bodyPivot.rotation.x = 0.08 * strideWeight * amp;
    bodyPivot.rotation.z = Math.sin(phase) * 0.04 * amp;
    baseY += Math.abs(Math.sin(phase)) * 0.055 * amp * strideWeight;
    const turnLook = Math.max(-0.28, Math.min(0.28, (options.turnRate ?? 0) * 0.12));
    headGroup.rotation.y = turnLook * amp;
  } else {
    switch (state) {
      case "coding": {
        const typeFast = Math.sin(t * 18) * 0.25 * amp;
        leftArm.rotation.x = -0.95 + typeFast;
        rightArm.rotation.x = -0.95 - typeFast;
        headGroup.rotation.x = 0.12;
        break;
      }
      case "thinking": {
        headGroup.rotation.z = Math.sin(t * 1.8) * 0.14 * amp;
        headGroup.rotation.y = Math.sin(t * 1.1) * 0.18 * amp;
        rightArm.rotation.x = -1.2;
        rightArm.rotation.z = -0.25;
        break;
      }
      case "waiting": {
        baseY += Math.sin(t * 2.2) * 0.02 * amp;
        break;
      }
      case "paused_budget": {
        headGroup.rotation.x = 0.45;
        leftArm.rotation.x = -0.2;
        rightArm.rotation.x = -0.2;
        break;
      }
      case "error": {
        const wave = Math.sin(t * 8) * 0.2 * amp;
        leftArm.rotation.x = -2.4 + wave;
        rightArm.rotation.x = -2.4 - wave;
        headGroup.rotation.z = Math.sin(t * 5) * 0.1 * amp;
        break;
      }
      case "awaiting_hire": {
        headGroup.rotation.y = Math.sin(t * 1.6) * 0.35 * amp;
        break;
      }
      case "paused":
      case "idle":
      case "meeting":
      default: {
        switch (options.actionPose) {
          case "chatting": {
            headGroup.rotation.y = Math.sin(t * 2.4) * 0.2 * amp;
            headGroup.rotation.x = Math.sin(t * 4.2) * 0.09 * amp;
            leftArm.rotation.x = -0.55 + Math.sin(t * 3.8) * 0.22 * amp;
            rightArm.rotation.x = -0.65 - Math.cos(t * 3.4) * 0.24 * amp;
            leftArm.rotation.z = 0.12;
            rightArm.rotation.z = -0.12;
            bodyPivot.rotation.z = Math.sin(t * 1.4) * 0.03 * amp;
            break;
          }
          case "drinking": {
            const p =
              options.actionProgress !== undefined
                ? Math.max(0, Math.min(1, options.actionProgress))
                : (t * 0.55) % 1;
            const lift = actionEnvelope(p, 0.2, 0.2);
            const sip =
              p >= 0.2 && p <= 0.8
                ? Math.max(0, Math.sin(((p - 0.2) / 0.6) * Math.PI * 2))
                : 0;
            // Swing right arm inward via Ry (independent of Rx) so the cup reaches the mouth upright
            rightArm.rotation.x = -lift * (1.52 + sip * 0.28);
            rightArm.rotation.y = -lift * 0.54;
            rightArm.rotation.z = lift * 0.08;
            headGroup.rotation.x = -lift * (0.1 + sip * 0.18);
            leftArm.rotation.x = -lift * 0.16 + Math.sin(t * 1.2) * 0.05 * amp;
            heldItemMount.position.set(-0.02 * lift, -0.46, 0.16);
            heldItemMount.rotation.x = lift * (1.28 - sip * 0.42);
            break;
          }
          case "inspecting": {
            const reach = actionEnvelope(options.actionProgress, 0.18, 0.2);
            const wavePhase = (options.actionProgress ?? t * 0.5) * Math.PI * 2;
            bodyPivot.rotation.x = 0.11 * reach;
            headGroup.rotation.x = 0.24 * reach;
            headGroup.rotation.y = Math.sin(wavePhase) * 0.2 * reach;
            rightArm.rotation.x = (-1.05 - Math.sin(wavePhase * 2) * 0.18) * reach;
            rightArm.rotation.y = -0.22 * reach;
            leftArm.rotation.x = -0.28 * reach;
            break;
          }
          case "reading": {
            const p = options.actionProgress;
            const hold = actionEnvelope(p, 0.16, 0.16);
            const scan = p !== undefined ? p * Math.PI * 3.2 : t * 1.6;
            const pageFlip =
              p !== undefined && p > 0.42 && p < 0.62
                ? -0.2 * Math.sin(((p - 0.42) / 0.2) * Math.PI)
                : 0;
            headGroup.rotation.x = 0.34 * hold;
            headGroup.rotation.y = Math.sin(scan) * 0.18 * hold;
            leftArm.rotation.x = -1.12 * hold + pageFlip;
            rightArm.rotation.x = -1.12 * hold;
            // Swing both forward arms inward via Ry so hands cradle the book centered at chest
            leftArm.rotation.y = 0.38 * hold;
            rightArm.rotation.y = -0.38 * hold;
            leftArm.rotation.z = -0.06 * hold;
            rightArm.rotation.z = 0.06 * hold;
            heldItemMount.position.set(-0.09 * hold, -0.46, 0.16);
            heldItemMount.rotation.set(0.68 * hold, -0.18 * hold, 0);
            break;
          }
          case "giving": {
            const reach = actionEnvelope(options.actionProgress, 0.18, 0.24);
            rightArm.rotation.x = -1.24 * reach;
            rightArm.rotation.y = -0.24 * reach;
            leftArm.rotation.x = -0.92 * reach;
            leftArm.rotation.y = 0.22 * reach;
            bodyPivot.rotation.x = 0.08 * reach;
            headGroup.rotation.x = 0.12 * reach;
            break;
          }
          case "waving": {
            const env = actionEnvelope(options.actionProgress, 0.15, 0.2);
            const wavePhase = t * 11;
            baseY += Math.abs(Math.sin(t * 5.2)) * 0.03 * amp * env;
            rightArm.rotation.x = -2.45 * env;
            rightArm.rotation.z = (-0.32 + Math.sin(wavePhase) * 0.34 * amp) * env;
            leftArm.rotation.x = Math.sin(t * 1.6) * 0.08 * amp;
            headGroup.rotation.z = 0.08 * env;
            headGroup.rotation.y = Math.sin(t * 2.2) * 0.12 * amp * env;
            break;
          }
          case "stretching": {
            const env = actionEnvelope(options.actionProgress, 0.22, 0.25);
            bodyPivot.rotation.x = -0.1 * env;
            headGroup.rotation.x = -0.22 * env;
            leftArm.rotation.x = -2.72 * env;
            rightArm.rotation.x = -2.72 * env;
            leftArm.rotation.z = 0.22 * env;
            rightArm.rotation.z = -0.22 * env;
            break;
          }
          case "celebrating": {
            const env = actionEnvelope(options.actionProgress, 0.12, 0.18);
            const jumpWave = t * 9.5;
            baseY += Math.abs(Math.sin(jumpWave)) * 0.16 * amp * env;
            leftArm.rotation.x = (-2.55 + Math.sin(jumpWave) * 0.28 * amp) * env;
            rightArm.rotation.x = (-2.55 - Math.sin(jumpWave) * 0.28 * amp) * env;
            leftArm.rotation.z = 0.28 * env;
            rightArm.rotation.z = -0.28 * env;
            headGroup.rotation.x = -0.12 * env;
            headGroup.rotation.z = Math.sin(t * 4.5) * 0.09 * amp * env;
            break;
          }
          case "playing_arcade": {
            baseY += Math.abs(Math.sin(t * 6.5)) * 0.025 * amp;
            bodyPivot.rotation.x = 0.14;
            headGroup.rotation.x = 0.12;
            headGroup.rotation.y = Math.sin(t * 3.1) * 0.08 * amp;
            leftArm.rotation.x = -1.08 + Math.sin(t * 14) * 0.18 * amp;
            rightArm.rotation.x = -1.08 + Math.cos(t * 16) * 0.2 * amp;
            leftArm.rotation.y = 0.18;
            rightArm.rotation.y = -0.18;
            break;
          }
          case "petting": {
            const env = actionEnvelope(options.actionProgress, 0.16, 0.22);
            bodyPivot.rotation.x = 0.32 * env;
            headGroup.rotation.x = 0.36 * env;
            rightArm.rotation.x = (-1.15 + Math.sin(t * 9) * 0.2 * amp) * env;
            rightArm.rotation.y = -0.18 * env;
            leftArm.rotation.x = -0.24 * env;
            break;
          }
          case "feeding": {
            const env = actionEnvelope(options.actionProgress, 0.16, 0.22);
            const tossPhase = (options.actionProgress ?? t * 0.8) * Math.PI * 3.5;
            bodyPivot.rotation.x = 0.12 * env;
            headGroup.rotation.x = 0.22 * env;
            rightArm.rotation.x = (-1.05 - Math.sin(tossPhase) * 0.38 * amp) * env;
            rightArm.rotation.y = Math.sin(tossPhase) * 0.42 * env;
            leftArm.rotation.x = -0.35 * env;
            break;
          }
          case "clapping": {
            const env = actionEnvelope(options.actionProgress, 0.12, 0.18);
            const clap = Math.abs(Math.sin(t * 11)) * 0.24 * amp;
            baseY += Math.abs(Math.sin(t * 5.5)) * 0.025 * amp * env;
            leftArm.rotation.x = -1.15 * env;
            rightArm.rotation.x = -1.15 * env;
            leftArm.rotation.y = (0.22 + clap) * env;
            rightArm.rotation.y = (-0.22 - clap) * env;
            leftArm.rotation.z = -0.08 * env;
            rightArm.rotation.z = 0.08 * env;
            headGroup.rotation.x = Math.sin(t * 5.5) * 0.08 * amp * env;
            break;
          }
          case "none":
          default: {
            baseY += Math.sin(t * 1.8) * 0.015 * amp;
            headGroup.rotation.y = Math.sin(t * 0.7) * 0.22 * amp;
            leftArm.rotation.x = Math.sin(t * 1.5) * 0.06 * amp;
            if (options.hasHeldItem) {
              rightArm.rotation.x = -0.42 + Math.sin(t * 1.5) * 0.03 * amp;
              rightArm.rotation.z = -0.06;
            } else {
              rightArm.rotation.x = -Math.sin(t * 1.5) * 0.06 * amp;
            }
            break;
          }
        }
        break;
      }
    }
  }

  bodyPivot.position.y = baseY;

  if (statusOrb.visible && amp > 0) {
    statusOrb.position.y = 1.75 + Math.sin(t * 3) * 0.05;
    statusOrb.rotation.y = t * 1.5;
  }
}

export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (!mat) continue;
        const std = mat as THREE.MeshStandardMaterial;
        std.map?.dispose();
        mat.dispose();
      }
    }
  });
}

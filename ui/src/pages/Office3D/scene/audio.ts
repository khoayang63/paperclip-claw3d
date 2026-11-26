import type { WeatherKind } from "../model/types";

export interface SpatialAudioSource {
  kind: "keyboard" | "server" | "coffee" | "rain_window";
  x: number;
  z: number;
}

/**
 * Web Audio API positional + notification sound engine.
 * Stays strictly muted by default and only creates an AudioContext after explicit user interaction.
 */
export class OfficeSpatialAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = true;
  private volume = 0.4;
  private lastAmbientTick = 0;
  private disposed = false;

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) {
      this.ensureContext();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed || this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    durationSec: number,
    gainLevel: number,
    type: OscillatorType = "sine",
    startOffset = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const start = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainLevel), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }

  playTaskCompleted(): void {
    if (this.muted) return;
    this.playTone(880, 0.16, 0.14, "sine", 0);
    this.playTone(1318.5, 0.24, 0.16, "triangle", 0.08);
  }

  playErrorAlert(): void {
    if (this.muted) return;
    this.playTone(340, 0.12, 0.16, "square", 0);
    this.playTone(260, 0.18, 0.16, "square", 0.14);
  }

  playApprovalStamp(): void {
    if (this.muted) return;
    this.playTone(220, 0.09, 0.2, "triangle", 0);
    this.playTone(660, 0.15, 0.12, "sine", 0.07);
  }

  /**
   * Periodic lightweight positional ambient sound pulses based on player proximity.
   */
  tickPositionalAmbient(
    nowMs: number,
    playerX: number,
    playerZ: number,
    sources: readonly SpatialAudioSource[],
    weather: WeatherKind,
    weatherVolume: number,
  ): void {
    if (this.muted || this.disposed) return;
    if (nowMs - this.lastAmbientTick < 260) return;
    this.lastAmbientTick = nowMs;

    let closestKeyboard = Infinity;
    let closestServer = Infinity;
    let closestCoffee = Infinity;

    for (const src of sources) {
      const dist = Math.hypot(playerX - src.x, playerZ - src.z);
      if (src.kind === "keyboard" && dist < closestKeyboard) closestKeyboard = dist;
      if (src.kind === "server" && dist < closestServer) closestServer = dist;
      if (src.kind === "coffee" && dist < closestCoffee) closestCoffee = dist;
    }

    const maxRange = 6.5;
    if (closestKeyboard < maxRange && Math.random() < 0.72) {
      const falloff = 1 - closestKeyboard / maxRange;
      const pitch = 950 + Math.random() * 500;
      this.playTone(pitch, 0.03, 0.045 * falloff, "triangle", 0);
    }

    if (closestServer < maxRange) {
      const falloff = 1 - closestServer / maxRange;
      this.playTone(110, 0.22, 0.03 * falloff, "sine", 0);
    }

    if (closestCoffee < 4.5 && Math.random() < 0.35) {
      const falloff = 1 - closestCoffee / 4.5;
      this.playTone(520 + Math.random() * 140, 0.11, 0.025 * falloff, "sine", 0);
    }

    if (weather === "rain" && weatherVolume > 0.01 && Math.random() < 0.8) {
      this.playTone(1800 + Math.random() * 1200, 0.07, 0.018 * weatherVolume, "sine", 0);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.muted = true;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

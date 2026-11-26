import * as THREE from "three";
import type { OfficeColorToken } from "../model/types";

export class OfficePalette {
  private readonly colorCache = new Map<string, THREE.Color>();
  private readonly cssCache = new Map<string, string>();
  private observer: MutationObserver | null = null;
  private onInvalidate: (() => void) | null = null;

  constructor(onInvalidate?: () => void) {
    this.onInvalidate = onInvalidate ?? null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      this.observer = new MutationObserver(() => {
        this.clear();
        this.onInvalidate?.();
      });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
  }

  clear(): void {
    this.colorCache.clear();
    this.cssCache.clear();
  }

  getCss(token: OfficeColorToken): string {
    const cached = this.cssCache.get(token);
    if (cached) return cached;

    let value = "";
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    }
    this.cssCache.set(token, value);
    return value;
  }

  getColor(token: OfficeColorToken, out?: THREE.Color): THREE.Color {
    const target = out ?? new THREE.Color();
    const cached = this.colorCache.get(token);
    if (cached) {
      return target.copy(cached);
    }

    const color = new THREE.Color(0.5, 0.55, 0.62);
    const cssValue = this.getCss(token);
    if (cssValue) {
      try {
        color.setStyle(cssValue);
      } catch {
        // Keep safe neutral fallback when running in non-CSS test environments
      }
    }
    this.colorCache.set(token, color);
    return target.copy(color);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.clear();
  }
}

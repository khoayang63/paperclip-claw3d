import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HEADWEAR,
  AVATAR_OUTFITS,
  AVATAR_SKIN_TONES,
} from "../model/constants";
import type {
  AvatarHairColor,
  AvatarSkinConfig,
  AvatarSkinTone,
} from "../model/types";
import { useOfficeT } from "../officeCopy";

const SKIN_TOKEN: Record<AvatarSkinTone, string> = {
  tone1: "var(--office-skin-tone1)",
  tone2: "var(--office-skin-tone2)",
  tone3: "var(--office-skin-tone3)",
  tone4: "var(--office-skin-tone4)",
  tone5: "var(--office-skin-tone5)",
};

const HAIR_TOKEN: Record<AvatarHairColor, string> = {
  black: "var(--office-hair-black)",
  brown: "var(--office-hair-brown)",
  blonde: "var(--office-hair-blonde)",
  red: "var(--office-hair-red)",
  gray: "var(--office-hair-gray)",
  blue: "var(--office-hair-blue)",
};

export interface WardrobeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skin: AvatarSkinConfig;
  targetLabel?: string;
  onChange: (next: AvatarSkinConfig) => void;
}

export function WardrobeModal({
  open,
  onOpenChange,
  skin,
  targetLabel,
  onChange,
}: WardrobeModalProps) {
  const ot = useOfficeT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ot("office3d.wardrobe.title")} — {targetLabel ?? ot("office3d.wardrobe.targetPlayer")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ot("office3d.wardrobe.outfit")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AVATAR_OUTFITS.map((outfit) => (
                <Button
                  key={outfit}
                  type="button"
                  size="sm"
                  variant={skin.outfit === outfit ? "default" : "outline"}
                  onClick={() => onChange({ ...skin, outfit })}
                >
                  {outfit}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ot("office3d.wardrobe.headwear")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AVATAR_HEADWEAR.map((headwear) => (
                <Button
                  key={headwear}
                  type="button"
                  size="sm"
                  variant={skin.headwear === headwear ? "default" : "outline"}
                  onClick={() => onChange({ ...skin, headwear })}
                >
                  {headwear}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ot("office3d.wardrobe.skinTone")}
            </p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_SKIN_TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-label={tone}
                  onClick={() => onChange({ ...skin, skinTone: tone })}
                  style={{ ["--office-swatch-color" as string]: SKIN_TOKEN[tone] }}
                  className={cn(
                    "office-swatch size-8 rounded-full border-2 transition-transform",
                    skin.skinTone === tone
                      ? "scale-110 border-primary ring-2 ring-ring"
                      : "border-border",
                  )}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {ot("office3d.wardrobe.hairColor")}
            </p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_HAIR_COLORS.map((hair) => (
                <button
                  key={hair}
                  type="button"
                  aria-label={hair}
                  onClick={() => onChange({ ...skin, hairColor: hair })}
                  style={{ ["--office-swatch-color" as string]: HAIR_TOKEN[hair] }}
                  className={cn(
                    "office-swatch size-8 rounded-full border-2 transition-transform",
                    skin.hairColor === hair
                      ? "scale-110 border-primary ring-2 ring-ring"
                      : "border-border",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              {ot("office3d.wardrobe.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

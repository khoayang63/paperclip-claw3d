import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { TeamChatModelOption } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function isNonReasoningFreeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (!lower.endsWith(":free")) return false;
  return !lower.includes("reasoning") && !lower.includes("thinking");
}

function recommendedScore(modelId: string): number {
  const lower = modelId.toLowerCase();
  if (lower.includes("gemma") && lower.endsWith(":free")) return 0;
  if (lower.includes("flash") && lower.endsWith(":free")) return 1;
  if (lower.includes("llama") && lower.endsWith(":free")) return 2;
  if (isNonReasoningFreeModel(lower)) return 3;
  if (lower === "openrouter/free") return 4;
  return 10;
}

export interface ModelComboboxProps {
  value: string;
  onChange: (nextValue: string) => void;
  models: TeamChatModelOption[];
  loading?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  recommendedGroupLabel: string;
  allGroupLabel: string;
  emptyLabel: string;
  useCustomLabel: string;
}

export function ModelCombobox({
  value,
  onChange,
  models,
  loading = false,
  placeholder,
  searchPlaceholder,
  recommendedGroupLabel,
  allGroupLabel,
  emptyLabel,
  useCustomLabel,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
        )
      : models;

    const recommended = matched
      .filter((m) => recommendedScore(m.id) < 10)
      .sort((a, b) => recommendedScore(a.id) - recommendedScore(b.id) || a.id.localeCompare(b.id));
    const recommendedIds = new Set(recommended.map((m) => m.id));
    const others = matched.filter((m) => !recommendedIds.has(m.id));
    return { recommended, others, total: matched.length };
  }, [models, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = models.some(
    (m) => m.id.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  const selectedLabel = useMemo(() => {
    if (!value.trim()) return "";
    const found = models.find((m) => m.id === value);
    return found ? `${found.id}` : value;
  }, [models, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal px-3"
        >
          <span className={cn("truncate text-sm", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel || placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-2 space-y-2">
        <div className="flex items-center gap-1.5 border-b border-border pb-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-60 overflow-y-auto space-y-2">
          {loading ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading...</div>
          ) : (
            <>
              {filtered.recommended.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {recommendedGroupLabel}
                  </div>
                  {filtered.recommended.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                        value === m.id && "bg-accent font-medium",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono">{m.id}</div>
                        {m.label !== m.id && (
                          <div className="truncate text-muted-foreground">{m.label}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isNonReasoningFreeModel(m.id) && (
                          <Badge variant="secondary" className="text-xs">
                            fast
                          </Badge>
                        )}
                        {value === m.id && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {filtered.others.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {allGroupLabel} ({filtered.others.length})
                  </div>
                  {filtered.others.slice(0, 120).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                        value === m.id && "bg-accent font-medium",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono">{m.id}</div>
                        {m.label !== m.id && (
                          <div className="truncate text-muted-foreground">{m.label}</div>
                        )}
                      </div>
                      {value === m.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              )}

              {filtered.total === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">{emptyLabel}</div>
              )}
            </>
          )}
        </div>

        {trimmedQuery && !hasExactMatch && (
          <div className="border-t border-border pt-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full justify-start text-xs"
              onClick={() => {
                onChange(trimmedQuery);
                setOpen(false);
                setQuery("");
              }}
            >
              {useCustomLabel.replace("{{model}}", trimmedQuery)}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

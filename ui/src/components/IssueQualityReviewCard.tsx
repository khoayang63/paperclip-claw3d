import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronDown, ChevronUp, RotateCcw, Star } from "lucide-react";
import type { IssueQualityVerdict } from "@paperclipai/shared";
import { performanceApi } from "@/api/performance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { usePerformanceCopy } from "@/pages/Performance/performanceCopy";

export interface IssueQualityReviewCardProps {
  issueId: string;
  companyId: string;
  issueStatus: string;
}

export function IssueQualityReviewCard({
  issueId,
  companyId,
  issueStatus,
}: IssueQualityReviewCardProps) {
  const copy = usePerformanceCopy();
  const queryClient = useQueryClient();

  const reviewQuery = useQuery({
    queryKey: queryKeys.performance.issueReview(issueId),
    queryFn: () => performanceApi.getIssueQualityReview(issueId),
    enabled: Boolean(issueId),
  });

  const existing = reviewQuery.data?.review ?? null;

  const [rating, setRating] = useState<number>(existing?.rating ?? 5);
  const [verdict, setVerdict] = useState<IssueQualityVerdict>(existing?.verdict ?? "pass");
  const [note, setNote] = useState<string>(existing?.note ?? "");
  const [reopenIssue, setReopenIssue] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (!existing) return;
    setRating(existing.rating);
    setVerdict(existing.verdict);
    setNote(existing.note ?? "");
    setReopenIssue(false);
    setCollapsed(true);
  }, [existing]);

  const mutation = useMutation({
    mutationFn: () =>
      performanceApi.upsertIssueQualityReview(issueId, {
        rating,
        verdict,
        note: note.trim() ? note.trim() : null,
        reopenIssue: verdict === "needs_rework" && reopenIssue,
      }),
    onSuccess: () => {
      setSavedNotice(true);
      setReopenIssue(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performance.issueReview(issueId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      void queryClient.invalidateQueries({ queryKey: ["performance", companyId] });
      window.setTimeout(() => setSavedNotice(false), 2000);
    },
  });

  const shouldShow =
    issueStatus === "done" || issueStatus === "in_review" || Boolean(existing);
  if (!shouldShow) return null;

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className={cn(collapsed ? "py-2.5" : "pb-2")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="text-sm">{copy("performance.review.title")}</CardTitle>
            {existing ? (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 font-mono text-xs",
                  existing.verdict === "pass"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                {existing.rating}/5 ·{" "}
                {existing.verdict === "pass"
                  ? copy("performance.review.verdictPass")
                  : copy("performance.review.verdictRework")}
              </Badge>
            ) : collapsed ? (
              <span className="text-xs text-muted-foreground">
                {copy("performance.review.unrated")}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {!collapsed ? (
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((value) => {
                  const active = value <= rating;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={`${value} stars`}
                      onClick={() => setRating(value)}
                      className="rounded p-1 hover:bg-muted transition-colors"
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          active ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            ) : null}

            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <>
                  <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {existing ? copy("performance.review.edit") : copy("performance.review.expand")}
                </>
              ) : (
                <>
                  <ChevronUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {copy("performance.review.hide")}
                </>
              )}
            </Button>
          </div>
        </div>
        {!collapsed ? (
          <CardDescription className="text-xs">
            {copy("performance.review.subtitle")}
          </CardDescription>
        ) : null}
      </CardHeader>

      {!collapsed ? (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={verdict === "pass" ? "default" : "outline"}
              onClick={() => {
                setVerdict("pass");
                setReopenIssue(false);
              }}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {copy("performance.review.verdictPass")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={verdict === "needs_rework" ? "destructive" : "outline"}
              onClick={() => setVerdict("needs_rework")}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {copy("performance.review.verdictRework")}
            </Button>

            {verdict === "needs_rework" && issueStatus === "done" ? (
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={reopenIssue}
                  onChange={(e) => setReopenIssue(e.target.checked)}
                />
                <span>{copy("performance.review.reopenToggle")}</span>
              </label>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={copy("performance.review.notePlaceholder")}
              className="flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="shrink-0"
            >
              {savedNotice ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {copy("performance.review.saved")}
                </>
              ) : mutation.isPending ? (
                copy("performance.review.saving")
              ) : (
                copy("performance.review.save")
              )}
            </Button>
          </div>

          {mutation.isError ? (
            <p className="text-xs text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : "Failed to save review"}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

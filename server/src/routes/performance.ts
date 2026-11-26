import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  isUuidLike,
  performanceWindowSchema,
  upsertIssueQualityReviewSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { notFound } from "../errors.js";
import { issueService } from "../services/issues.js";
import { performanceService, type PerformanceActorContext } from "../services/performance.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

function toActorContext(req: Request): PerformanceActorContext {
  const actor = getActorInfo(req);
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    userId: actor.actorType === "user" ? actor.actorId : null,
    agentId: actor.agentId,
    runId: actor.runId,
    agentApiKeyId: actor.agentApiKeyId,
  };
}

export function performanceRoutes(db: Db) {
  const router = Router();
  const svc = performanceService(db);
  const issuesSvc = issueService(db);

  async function resolveIssueByIdOrIdentifier(rawId: string) {
    const trimmed = rawId.trim();
    const issue = isUuidLike(trimmed)
      ? await issuesSvc.getById(trimmed)
      : await issuesSvc.getByIdentifier(trimmed);
    if (!issue) {
      throw notFound("Issue not found");
    }
    return issue;
  }

  router.get("/companies/:companyId/performance", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsedWindow = performanceWindowSchema.safeParse(
      typeof req.query.window === "string" ? req.query.window : "30d",
    );
    const window = parsedWindow.success ? parsedWindow.data : "30d";
    const report = await svc.getCompanyPerformance(companyId, window);
    res.json(report);
  });

  router.get("/issues/:issueId/quality-review", async (req, res) => {
    const issue = await resolveIssueByIdOrIdentifier(req.params.issueId as string);
    assertCompanyAccess(req, issue.companyId);
    const review = await svc.getIssueQualityReview(issue.companyId, issue.id);
    res.json({ review });
  });

  router.put(
    "/issues/:issueId/quality-review",
    validate(upsertIssueQualityReviewSchema),
    async (req, res) => {
      assertBoard(req);
      const issue = await resolveIssueByIdOrIdentifier(req.params.issueId as string);
      assertCompanyAccess(req, issue.companyId);
      const input = upsertIssueQualityReviewSchema.parse(req.body);
      const actor = toActorContext(req);
      const result = await svc.upsertIssueQualityReview(issue.companyId, issue.id, input, actor);
      res.json(result);
    },
  );

  return router;
}

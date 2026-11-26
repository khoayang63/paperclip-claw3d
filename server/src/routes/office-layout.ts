import { Router } from "express";
import { eq } from "drizzle-orm";
import { companies, type Db } from "@paperclipai/db";
import { upsertCompanyOfficeLayoutSchema } from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { officeCodeSpaceService } from "../services/office-code-space.js";
import { officeLayoutService } from "../services/office-layout.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function officeLayoutRoutes(db: Db) {
  const router = Router();
  const svc = officeLayoutService(db);

  router.get("/companies/:companyId/office-layout", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) throw notFound("Company not found");
    res.json(await svc.get(companyId));
  });

  router.put(
    "/companies/:companyId/office-layout",
    validate(upsertCompanyOfficeLayoutSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
      if (!company) throw notFound("Company not found");
      const actor = getActorInfo(req);
      const updated = await svc.upsert(
        companyId,
        {
          layout: req.body.layout,
          agentSkins: req.body.agentSkins,
        },
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
        },
      );
      res.json(updated);
    },
  );

  router.get("/companies/:companyId/office-workspaces", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) throw notFound("Company not found");
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const workspaces = await officeCodeSpaceService(db).listWorkspaces(companyId, { agentId });
    res.json({ workspaces });
  });

  router.get("/companies/:companyId/office-workspaces/:workspaceKey/tree", async (req, res) => {
    const companyId = req.params.companyId as string;
    const workspaceKey = req.params.workspaceKey as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) throw notFound("Company not found");
    const relPath = typeof req.query.path === "string" ? req.query.path : undefined;
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    res.json(
      await officeCodeSpaceService(db).getTree(companyId, workspaceKey, {
        path: relPath,
        agentId,
      }),
    );
  });

  router.get("/companies/:companyId/office-workspaces/:workspaceKey/file", async (req, res) => {
    const companyId = req.params.companyId as string;
    const workspaceKey = req.params.workspaceKey as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) throw notFound("Company not found");
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    res.json(
      await officeCodeSpaceService(db).getFile(companyId, workspaceKey, {
        path: relPath,
        agentId,
      }),
    );
  });

  return router;
}

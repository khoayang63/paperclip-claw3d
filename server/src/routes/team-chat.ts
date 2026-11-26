import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createTeamChatMessageSchema,
  createTeamChatRoomSchema,
  discussTeamChatRoomSchema,
  promoteTeamChatMessageSchema,
  updateTeamChatRoomSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { teamChatService, type TeamChatActorContext } from "../services/team-chat.js";

function assertBoardMutation(req: Request, companyId: string) {
  assertBoard(req);
  assertCompanyAccess(req, companyId);
  if (
    req.actor.type === "board" &&
    req.actor.source !== "local_implicit" &&
    !req.actor.isInstanceAdmin &&
    req.actor.memberships?.some(
      (m) =>
        m.companyId === companyId &&
        m.status === "active" &&
        m.membershipRole === "viewer",
    )
  ) {
    throw forbidden("Viewer access cannot modify team chat");
  }
}

function toActorContext(req: Request): TeamChatActorContext {
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

export function teamChatRoutes(
  db: Db,
  options?: Parameters<typeof teamChatService>[1],
) {
  const router = Router();
  const svc = teamChatService(db, options);

  router.get("/companies/:companyId/team-chat/connections", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = toActorContext(req);
    const choices = await svc.listConnectionChoices(companyId, actor.userId);
    res.json(choices);
  });

  router.get("/companies/:companyId/team-chat/connections/:connectionId/models", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = toActorContext(req);
    const models = await svc.listModelsForConnection(companyId, connectionId, actor.userId);
    res.json(models);
  });

  router.get("/companies/:companyId/team-chat/rooms", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rooms = await svc.listRooms(companyId);
    res.json(rooms);
  });

  router.post(
    "/companies/:companyId/team-chat/rooms",
    validate(createTeamChatRoomSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardMutation(req, companyId);
      const room = await svc.createRoom(companyId, req.body, toActorContext(req));
      res.status(201).json(room);
    },
  );

  router.get("/companies/:companyId/team-chat/rooms/:roomId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertCompanyAccess(req, companyId);
    const detail = await svc.getRoom(companyId, roomId);
    res.json(detail);
  });

  router.patch(
    "/companies/:companyId/team-chat/rooms/:roomId",
    validate(updateTeamChatRoomSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertBoardMutation(req, companyId);
      const room = await svc.updateRoom(companyId, roomId, req.body, toActorContext(req));
      res.json(room);
    },
  );

  router.delete("/companies/:companyId/team-chat/rooms/:roomId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const roomId = req.params.roomId as string;
    assertBoardMutation(req, companyId);
    await svc.archiveRoom(companyId, roomId, toActorContext(req));
    res.status(204).end();
  });

  router.post(
    "/companies/:companyId/team-chat/rooms/:roomId/messages",
    validate(createTeamChatMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertBoardMutation(req, companyId);
      const result = await svc.postMessage(companyId, roomId, req.body, toActorContext(req));
      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/team-chat/rooms/:roomId/discuss",
    validate(discussTeamChatRoomSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      assertBoardMutation(req, companyId);
      const result = await svc.triggerDiscussion(companyId, roomId, req.body, toActorContext(req));
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/team-chat/rooms/:roomId/messages/:messageId/promote",
    validate(promoteTeamChatMessageSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const roomId = req.params.roomId as string;
      const messageId = req.params.messageId as string;
      assertBoardMutation(req, companyId);
      const result = await svc.promoteMessageToIssue(
        companyId,
        roomId,
        messageId,
        req.body,
        toActorContext(req),
      );
      res.status(201).json(result);
    },
  );

  return router;
}

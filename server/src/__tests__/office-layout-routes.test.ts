import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { officeLayoutRoutes } from "../routes/office-layout.js";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
  findCompany: vi.fn(),
}));

vi.mock("../services/office-layout.js", () => ({
  officeLayoutService: () => mocks,
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "22222222-2222-4222-8222-222222222222";
const url = `/api/companies/${companyId}/office-layout`;

const samplePayload = {
  layout: {
    schemaVersion: 1,
    companyId,
    buildings: [
      {
        id: "b1",
        name: "HQ",
        floors: [
          {
            id: "f1",
            name: "Floor 1",
            gridSize: [30, 30],
            elevatorCell: [14, 1],
            rooms: [],
            desks: [],
            furniture: [
              { id: "furn-b1", kind: "bookshelf", x: 5, z: 5, rotation: 0, roomId: null },
              { id: "furn-w1", kind: "water_cooler", x: 7, z: 5, rotation: 90, roomId: null },
              { id: "furn-p1", kind: "printer", x: 9, z: 5, rotation: 180, roomId: null },
              { id: "furn-f1", kind: "filing_cabinet", x: 11, z: 5, rotation: 270, roomId: null },
            ],
          },
        ],
      },
    ],
    updatedAt: "2026-11-24T12:00:00.000Z",
  },
  agentSkins: {
    "agent-1": {
      outfit: "hoodie",
      headwear: "headset",
      skinTone: "tone2",
      hairColor: "black",
    },
  },
};

const boardAdmin: Express.Request["actor"] = {
  type: "board",
  source: "session",
  userId: "alice",
  companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "owner", status: "active" }],
};

const viewer: Express.Request["actor"] = {
  type: "board",
  source: "session",
  userId: "bob",
  companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "viewer", status: "active" }],
};

const makeApp = (identity: Express.Request["actor"] = boardAdmin) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = identity;
    next();
  });
  app.use(
    "/api",
    officeLayoutRoutes({
      query: { companies: { findFirst: mocks.findCompany } },
    } as never),
  );
  app.use(errorHandler);
  return app;
};

describe("office layout routes & authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCompany.mockResolvedValue({ id: companyId });
    mocks.get.mockResolvedValue({
      companyId,
      layout: null,
      agentSkins: {},
      updatedAt: null,
    });
    mocks.upsert.mockResolvedValue({
      companyId,
      layout: samplePayload.layout,
      agentSkins: samplePayload.agentSkins,
      updatedAt: "2026-11-24T12:00:00.000Z",
    });
  });

  it("allows company board members to read and update company office layout", async () => {
    await request(makeApp(boardAdmin)).get(url).expect(200);
    expect(mocks.get).toHaveBeenCalledWith(companyId);

    await request(makeApp(boardAdmin)).put(url).send(samplePayload).expect(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      companyId,
      { layout: samplePayload.layout, agentSkins: samplePayload.agentSkins },
      expect.objectContaining({ actorType: "user", actorId: "alice" }),
    );
  });

  it("allows viewers to read but forbids viewers and agents from mutating layout", async () => {
    await request(makeApp(viewer)).get(url).expect(200);
    await request(makeApp(viewer)).put(url).send(samplePayload).expect(403);

    const sameCompanyAgent: Express.Request["actor"] = {
      type: "agent",
      source: "agent_key",
      companyId,
      agentId: "agent-1",
    };
    await request(makeApp(sameCompanyAgent)).get(url).expect(200);
    await request(makeApp(sameCompanyAgent)).put(url).send(samplePayload).expect(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("blocks cross-company access, unauthenticated requests, invalid payloads, and missing companies", async () => {
    const foreignAgent: Express.Request["actor"] = {
      type: "agent",
      source: "agent_key",
      companyId: otherCompanyId,
      agentId: "agent-x",
    };
    await request(makeApp(foreignAgent)).get(url).expect(403);
    await request(makeApp({ type: "none", source: "none" } as Express.Request["actor"]))
      .get(url)
      .expect(401);

    await request(makeApp(boardAdmin))
      .put(url)
      .send({ layout: { schemaVersion: 2 } })
      .expect(400);

    mocks.findCompany.mockResolvedValue(null);
    await request(makeApp(boardAdmin)).get(url).expect(404);
    await request(makeApp(boardAdmin)).put(url).send(samplePayload).expect(404);
  });
});

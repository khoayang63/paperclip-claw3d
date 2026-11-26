import { eq } from "drizzle-orm";
import { companyOfficeLayouts, type Db } from "@paperclipai/db";
import type {
  AgentSkinsMapInput,
  OfficeLayoutDocumentInput,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { persistActivity, publishActivity } from "./activity-log.js";

export interface CompanyOfficeLayoutRecord {
  companyId: string;
  layout: OfficeLayoutDocumentInput | null;
  agentSkins: AgentSkinsMapInput;
  updatedAt: string | null;
}

export function officeLayoutService(db: Db) {
  async function get(companyId: string): Promise<CompanyOfficeLayoutRecord> {
    const row = await db.query.companyOfficeLayouts.findFirst({
      where: eq(companyOfficeLayouts.companyId, companyId),
    });
    if (!row) {
      return {
        companyId,
        layout: null,
        agentSkins: {},
        updatedAt: null,
      };
    }
    return {
      companyId,
      layout: row.layout as unknown as OfficeLayoutDocumentInput,
      agentSkins: (row.agentSkins ?? {}) as unknown as AgentSkinsMapInput,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return {
    get,
    async upsert(
      companyId: string,
      input: { layout: OfficeLayoutDocumentInput; agentSkins?: AgentSkinsMapInput },
      actor: { actorType: "user" | "agent"; actorId: string; agentId?: string | null; runId?: string | null },
    ): Promise<CompanyOfficeLayoutRecord> {
      const normalizedLayout: OfficeLayoutDocumentInput = {
        ...input.layout,
        companyId,
      };
      const result = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const existing = await txDb.query.companyOfficeLayouts.findFirst({
          where: eq(companyOfficeLayouts.companyId, companyId),
        });
        const nextSkins = (input.agentSkins ??
          existing?.agentSkins ??
          {}) as Record<string, unknown>;

        await tx
          .insert(companyOfficeLayouts)
          .values({
            companyId,
            layout: normalizedLayout as unknown as Record<string, unknown>,
            agentSkins: nextSkins,
            updatedByUserId: actor.actorId,
          })
          .onConflictDoUpdate({
            target: companyOfficeLayouts.companyId,
            set: {
              layout: normalizedLayout as unknown as Record<string, unknown>,
              agentSkins: nextSkins,
              updatedByUserId: actor.actorId,
              updatedAt: new Date(),
            },
          });

        const { publication } = await persistActivity(txDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "office_layout.updated",
          entityType: "company",
          entityId: companyId,
          details: {
            buildingCount: normalizedLayout.buildings.length,
          },
        });

        return {
          record: await officeLayoutService(txDb).get(companyId),
          publication,
        };
      });

      try {
        publishActivity(result.publication);
      } catch (err) {
        logger.warn({ err }, "Could not publish office layout update activity");
      }

      return result.record;
    },
  };
}

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyOfficeLayouts = pgTable("company_office_layouts", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  layout: jsonb("layout").$type<Record<string, unknown>>().notNull(),
  agentSkins: jsonb("agent_skins").$type<Record<string, unknown>>().notNull().default({}),
  updatedByUserId: text("updated_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

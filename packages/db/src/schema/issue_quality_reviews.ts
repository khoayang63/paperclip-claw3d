import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const issueQualityReviews = pgTable(
  "issue_quality_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    verdict: text("verdict").notNull(),
    note: text("note"),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueUq: uniqueIndex("issue_quality_reviews_company_issue_uq").on(
      table.companyId,
      table.issueId,
    ),
    companyAgentIdx: index("issue_quality_reviews_company_agent_idx").on(
      table.companyId,
      table.agentId,
    ),
    companyUpdatedIdx: index("issue_quality_reviews_company_updated_idx").on(
      table.companyId,
      table.updatedAt,
    ),
  }),
);

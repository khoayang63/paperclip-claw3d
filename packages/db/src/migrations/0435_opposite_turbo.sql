CREATE TABLE "issue_quality_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid,
	"rating" integer NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_quality_reviews" ADD CONSTRAINT "issue_quality_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_quality_reviews" ADD CONSTRAINT "issue_quality_reviews_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_quality_reviews" ADD CONSTRAINT "issue_quality_reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_quality_reviews_company_issue_uq" ON "issue_quality_reviews" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_quality_reviews_company_agent_idx" ON "issue_quality_reviews" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "issue_quality_reviews_company_updated_idx" ON "issue_quality_reviews" USING btree ("company_id","updated_at");
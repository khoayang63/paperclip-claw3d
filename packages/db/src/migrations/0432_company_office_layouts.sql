CREATE TABLE "company_office_layouts" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"layout" jsonb NOT NULL,
	"agent_skins" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_office_layouts" ADD CONSTRAINT "company_office_layouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
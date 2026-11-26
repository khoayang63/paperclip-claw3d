CREATE TABLE "team_chat_room_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_chat_room_members_room_agent_uq" UNIQUE("room_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "team_chat_room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" text,
	"author_agent_id" uuid,
	"body" text NOT NULL,
	"reply_to_message_id" uuid,
	"linked_issue_id" uuid,
	"provider" text,
	"model" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_chat_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'channel' NOT NULL,
	"topic" text,
	"persona_prompt" text,
	"ai_connection_id" uuid,
	"ai_connection_grant_id" uuid,
	"model" text,
	"max_auto_turns" integer DEFAULT 4 NOT NULL,
	"created_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_chat_rooms_company_slug_uq" UNIQUE("company_id","slug")
);
--> statement-breakpoint
ALTER TABLE "team_chat_room_members" ADD CONSTRAINT "team_chat_room_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_members" ADD CONSTRAINT "team_chat_room_members_room_id_team_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."team_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_members" ADD CONSTRAINT "team_chat_room_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_messages" ADD CONSTRAINT "team_chat_room_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_messages" ADD CONSTRAINT "team_chat_room_messages_room_id_team_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."team_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_messages" ADD CONSTRAINT "team_chat_room_messages_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_room_messages" ADD CONSTRAINT "team_chat_room_messages_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_chat_rooms" ADD CONSTRAINT "team_chat_rooms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_chat_room_members_company_room_idx" ON "team_chat_room_members" USING btree ("company_id","room_id");--> statement-breakpoint
CREATE INDEX "team_chat_room_messages_room_created_at_idx" ON "team_chat_room_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "team_chat_room_messages_company_room_created_at_idx" ON "team_chat_room_messages" USING btree ("company_id","room_id","created_at");--> statement-breakpoint
CREATE INDEX "team_chat_rooms_company_updated_idx" ON "team_chat_rooms" USING btree ("company_id","archived_at","updated_at");
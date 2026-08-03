CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"lead_person_id" uuid,
	"external_id" text,
	"external_system" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_status_ck" CHECK ("project"."status" IN ('active','paused','complete','archived')),
	CONSTRAINT "project_external_system_ck" CHECK ("project"."external_system" IS NULL OR "project"."external_system" IN ('internal','notion','clickup')),
	CONSTRAINT "project_external_pair_ck" CHECK (("project"."external_id" IS NULL) = ("project"."external_system" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "candidate_action_item" DROP CONSTRAINT "candidate_action_item_external_system_ck";--> statement-breakpoint
ALTER TABLE "tracked_item" DROP CONSTRAINT "tracked_item_content_by_source_ck";--> statement-breakpoint
ALTER TABLE "tracked_item" ALTER COLUMN "source_system" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tracked_item" ALTER COLUMN "source_system" SET DEFAULT 'internal';--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "external_task_id" text;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "candidate_action_item_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_lead_person_id_person_id_fk" FOREIGN KEY ("lead_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_lead_idx" ON "project" USING btree ("lead_person_id");--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_candidate_action_item_id_candidate_action_item_id_fk" FOREIGN KEY ("candidate_action_item_id") REFERENCES "public"."candidate_action_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracked_item_project_idx" ON "tracked_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tracked_item_owner_idx" ON "tracked_item" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "tracked_item_status_idx" ON "tracked_item" USING btree ("status");--> statement-breakpoint
ALTER TABLE "candidate_action_item" ADD CONSTRAINT "candidate_action_item_external_system_ck" CHECK ("candidate_action_item"."external_system" IS NULL OR "candidate_action_item"."external_system" IN ('internal','notion','clickup'));--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_source_system_ck" CHECK ("tracked_item"."source_system" IN ('internal','notion','clickup'));--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_external_ref_ck" CHECK (("tracked_item"."source_system" = 'internal' AND "tracked_item"."external_task_id" IS NULL)
          OR ("tracked_item"."source_system" <> 'internal' AND "tracked_item"."external_task_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_content_by_source_ck" CHECK ("tracked_item"."source_system" = 'internal' OR ("tracked_item"."title" IS NULL AND "tracked_item"."description" IS NULL));--> statement-breakpoint
DROP TYPE "public"."source_system";
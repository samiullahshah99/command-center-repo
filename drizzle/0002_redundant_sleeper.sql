CREATE TYPE "public"."source_system" AS ENUM('clickup', 'internal');--> statement-breakpoint
ALTER TABLE "tracked_item" ALTER COLUMN "clickup_task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "source_system" "source_system" DEFAULT 'clickup' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD COLUMN "assignee_person_id" uuid;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_assignee_person_id_person_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_content_by_source_ck" CHECK ("tracked_item"."source_system" <> 'clickup' OR ("tracked_item"."title" IS NULL AND "tracked_item"."description" IS NULL));
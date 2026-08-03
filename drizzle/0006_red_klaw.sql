CREATE TABLE "candidate_action_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unified_event_id" uuid NOT NULL,
	"description" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"owner_confidence" text NOT NULL,
	"due_date" date,
	"follow_ups" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" real NOT NULL,
	"source_span" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"edited_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"content_hash" text NOT NULL,
	"external_task_id" text,
	"external_system" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_action_item_owner_confidence_ck" CHECK ("candidate_action_item"."owner_confidence" IN ('exact','email','fuzzy','unresolved')),
	CONSTRAINT "candidate_action_item_review_status_ck" CHECK ("candidate_action_item"."review_status" IN ('pending','approved','rejected','auto_approved')),
	CONSTRAINT "candidate_action_item_external_system_ck" CHECK ("candidate_action_item"."external_system" IS NULL OR "candidate_action_item"."external_system" IN ('notion','internal')),
	CONSTRAINT "candidate_action_item_confidence_range_ck" CHECK ("candidate_action_item"."confidence" >= 0 AND "candidate_action_item"."confidence" <= 1),
	CONSTRAINT "candidate_action_item_owner_coherent_ck" CHECK (("candidate_action_item"."owner_confidence" = 'unresolved' AND "candidate_action_item"."owner_person_id" IS NULL)
          OR ("candidate_action_item"."owner_confidence" <> 'unresolved' AND "candidate_action_item"."owner_person_id" IS NOT NULL)),
	CONSTRAINT "candidate_action_item_review_provenance_ck" CHECK (("candidate_action_item"."review_status" = 'pending' AND "candidate_action_item"."reviewed_by" IS NULL AND "candidate_action_item"."reviewed_at" IS NULL)
          OR ("candidate_action_item"."review_status" = 'auto_approved' AND "candidate_action_item"."reviewed_at" IS NOT NULL)
          OR ("candidate_action_item"."review_status" IN ('approved','rejected') AND "candidate_action_item"."reviewed_by" IS NOT NULL AND "candidate_action_item"."reviewed_at" IS NOT NULL)),
	CONSTRAINT "candidate_action_item_external_pair_ck" CHECK (("candidate_action_item"."external_task_id" IS NULL) = ("candidate_action_item"."external_system" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "candidate_action_item" ADD CONSTRAINT "candidate_action_item_unified_event_id_unified_event_id_fk" FOREIGN KEY ("unified_event_id") REFERENCES "public"."unified_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_action_item" ADD CONSTRAINT "candidate_action_item_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_action_item_content_hash_key" ON "candidate_action_item" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "candidate_action_item_unified_event_idx" ON "candidate_action_item" USING btree ("unified_event_id");--> statement-breakpoint
CREATE INDEX "candidate_action_item_review_idx" ON "candidate_action_item" USING btree ("review_status","created_at");--> statement-breakpoint
CREATE INDEX "candidate_action_item_owner_idx" ON "candidate_action_item" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "candidate_action_item_unsynced_idx" ON "candidate_action_item" USING btree ("review_status") WHERE "candidate_action_item"."external_task_id" IS NULL;
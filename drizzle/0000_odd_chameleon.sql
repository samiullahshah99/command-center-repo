CREATE TYPE "public"."source_type" AS ENUM('meeting', 'slack', 'manual', 'system');--> statement-breakpoint
CREATE TABLE "completion_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_task_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"evidence_source" text,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tracked_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quota_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role_profile_id" uuid,
	"slack_id" text,
	"clickup_id" text,
	"portal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clickup_task_id" text NOT NULL,
	"owner_person_id" uuid,
	"source_type" "source_type" NOT NULL,
	"source_ref" text,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"last_update_at" timestamp with time zone,
	"risk_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"auto_complete_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fallback_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completion_event" ADD CONSTRAINT "completion_event_recurring_task_id_recurring_task_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_role_profile_id_role_profile_id_fk" FOREIGN KEY ("role_profile_id") REFERENCES "public"."role_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_item" ADD CONSTRAINT "tracked_item_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task" ADD CONSTRAINT "recurring_task_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_event_source_processed_idx" ON "raw_event" USING btree ("source","processed");
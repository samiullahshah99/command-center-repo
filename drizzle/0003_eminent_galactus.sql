CREATE TABLE "transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid,
	"fireflies_id" text NOT NULL,
	"title" text,
	"meeting_date" timestamp with time zone,
	"duration_seconds" integer,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_fireflies_id_unique" UNIQUE("fireflies_id")
);
--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_raw_event_id_raw_event_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_raw_event_id_idx" ON "transcript" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "transcript_meeting_date_idx" ON "transcript" USING btree ("meeting_date");
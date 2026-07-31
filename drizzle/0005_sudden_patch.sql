CREATE TABLE "unified_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"source_seq" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"occurred_at_source" text DEFAULT 'payload' NOT NULL,
	"person_id" uuid,
	"person_identity_id" uuid,
	"subject_type" text,
	"subject_id" text,
	"subject_label" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normaliser_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unified_event_source_ck" CHECK ("unified_event"."source" IN ('slack','clickup','fireflies','ugc','vision')),
	CONSTRAINT "unified_event_occurred_at_source_ck" CHECK ("unified_event"."occurred_at_source" IN ('payload','received_at'))
);
--> statement-breakpoint
ALTER TABLE "unified_event" ADD CONSTRAINT "unified_event_raw_event_id_raw_event_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_event" ADD CONSTRAINT "unified_event_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unified_event" ADD CONSTRAINT "unified_event_person_identity_id_person_identity_id_fk" FOREIGN KEY ("person_identity_id") REFERENCES "public"."person_identity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unified_event_raw_event_seq_key" ON "unified_event" USING btree ("raw_event_id","source_seq");--> statement-breakpoint
CREATE INDEX "unified_event_person_occurred_idx" ON "unified_event" USING btree ("person_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unified_event_source_occurred_idx" ON "unified_event" USING btree ("source","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unified_event_occurred_idx" ON "unified_event" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unified_event_event_type_idx" ON "unified_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "unified_event_identity_idx" ON "unified_event" USING btree ("person_identity_id");--> statement-breakpoint
CREATE INDEX "unified_event_subject_idx" ON "unified_event" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "unified_event_unattributed_idx" ON "unified_event" USING btree ("occurred_at" DESC NULLS LAST) WHERE "unified_event"."person_id" IS NULL;
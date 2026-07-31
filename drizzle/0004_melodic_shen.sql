CREATE TABLE "person_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"editor_name" text,
	"confidence" text,
	"linked_by" text,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_identity_source_ck" CHECK ("person_identity"."source" IN ('slack','clickup','vision','ugc','fireflies','portal')),
	CONSTRAINT "person_identity_confidence_ck" CHECK ("person_identity"."confidence" IS NULL OR "person_identity"."confidence" IN ('exact','email','manual')),
	CONSTRAINT "person_identity_link_provenance_ck" CHECK (("person_identity"."person_id" IS NULL AND "person_identity"."confidence" IS NULL AND "person_identity"."linked_at" IS NULL)
          OR ("person_identity"."person_id" IS NOT NULL AND "person_identity"."confidence" IS NOT NULL AND "person_identity"."linked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "person_identity" ADD CONSTRAINT "person_identity_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_identity_source_external_id_key" ON "person_identity" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "person_identity_person_id_idx" ON "person_identity" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_identity_email_lower_idx" ON "person_identity" USING btree (lower("email")) WHERE "person_identity"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "person_identity_unresolved_idx" ON "person_identity" USING btree ("source","created_at") WHERE "person_identity"."person_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "person_email_lower_idx" ON "person" USING btree (lower("email")) WHERE "person"."email" IS NOT NULL;
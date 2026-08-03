CREATE TABLE "ai_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"item_count" integer NOT NULL,
	"event_count" integer NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cost_usd" real NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_summary_counts_ck" CHECK ("ai_summary"."item_count" >= 0 AND "ai_summary"."event_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_summary" ADD CONSTRAINT "ai_summary_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_summary_person_key" ON "ai_summary" USING btree ("person_id");
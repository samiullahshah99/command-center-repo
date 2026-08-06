ALTER TABLE "completion_event" ADD COLUMN "signal" text NOT NULL;--> statement-breakpoint
ALTER TABLE "completion_event" ADD COLUMN "window_start" date NOT NULL;--> statement-breakpoint
ALTER TABLE "completion_event" ADD COLUMN "attribution" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "completion_event_task_window_key" ON "completion_event" USING btree ("recurring_task_id","window_start");--> statement-breakpoint
ALTER TABLE "completion_event" ADD CONSTRAINT "completion_event_attribution_ck" CHECK ("completion_event"."attribution" IN ('attributed','unattributed'));
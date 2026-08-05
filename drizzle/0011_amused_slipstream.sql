CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dept_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_dept_type_ck" CHECK ("department"."dept_type" IN ('creative','cx','ops','engineering'))
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "role_id" smallint;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "department_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "department_name_lower_idx" ON "department" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "role_code_key" ON "role" USING btree ("code");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_department_idx" ON "person" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "person_role_idx" ON "person" USING btree ("role_id");
CREATE TYPE "public"."expense_category" AS ENUM('materials', 'tools', 'subcontractor', 'mileage_fuel', 'permits_fees', 'overhead');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'cash', 'check', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."pricing_type" AS ENUM('fixed', 'time_and_materials');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('estimating', 'in_progress', 'completed', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'csv', 'plaid');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('matched', 'unassigned', 'ignored');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"client_name" text NOT NULL,
	"client_phone" text DEFAULT '' NOT NULL,
	"client_address" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_status" NOT NULL,
	"pricing_type" "pricing_type" NOT NULL,
	"quoted_total_cents" bigint NOT NULL,
	"quoted_materials_cents" bigint NOT NULL,
	"quoted_labor_hours" numeric(8, 2) NOT NULL,
	"target_hourly_rate_cents" bigint NOT NULL,
	"target_margin_pct" numeric(5, 2) NOT NULL,
	"start_date" date NOT NULL,
	"deadline_date" date,
	"completed_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"category" "expense_category" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"card_last4" text,
	"status" "transaction_status" NOT NULL,
	"project_id" uuid,
	"receipt_number" text,
	"tax_deductible" boolean DEFAULT false NOT NULL,
	"notes" text,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"provider" text,
	"external_id" text,
	"bank_account_id" uuid,
	"pending" boolean DEFAULT false NOT NULL,
	"pending_transaction_id" text,
	"posted_at" timestamp with time zone,
	"authorized_date" date,
	"raw_descriptor" text,
	"merchant_name" text,
	"category_hint_primary" text,
	"category_hint_detailed" text,
	"user_edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labor_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"hourly_rate_cents" bigint NOT NULL,
	"worker_name" text DEFAULT '' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"deposit_amount_cents" bigint NOT NULL,
	"date_issued" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" NOT NULL,
	"paid_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_account_id" text NOT NULL,
	"name" text,
	"official_name" text,
	"mask" text,
	"type" text,
	"subtype" text,
	"current_balance_cents" bigint,
	"available_balance_cents" bigint,
	"limit_cents" bigint,
	"iso_currency_code" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"balances_updated_at" timestamp with time zone,
	"cycle_reset_day" integer,
	"card_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_connection_external_key" UNIQUE("connection_id","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text DEFAULT 'plaid' NOT NULL,
	"item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"access_token_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"cursor" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_provider_item_key" UNIQUE("provider","item_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"provider" text DEFAULT 'plaid' NOT NULL,
	"item_id" text,
	"webhook_type" text,
	"webhook_code" text,
	"body_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_body_hash_key" UNIQUE("body_hash")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source" "transaction_source" NOT NULL,
	"filename" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_owner_created_idx" ON "projects" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_owner_status_idx" ON "projects" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_account_external_key" ON "transactions" USING btree ("provider","bank_account_id","external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_owner_date_idx" ON "transactions" USING btree ("owner_id","date");--> statement-breakpoint
CREATE INDEX "transactions_owner_project_idx" ON "transactions" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_unassigned_idx" ON "transactions" USING btree ("owner_id") WHERE "status" = 'unassigned';--> statement-breakpoint
CREATE INDEX "labor_entries_owner_project_idx" ON "labor_entries" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE INDEX "labor_entries_owner_date_idx" ON "labor_entries" USING btree ("owner_id","date");--> statement-breakpoint
CREATE INDEX "invoices_owner_paid_date_idx" ON "invoices" USING btree ("owner_id","paid_date");--> statement-breakpoint
CREATE INDEX "invoices_owner_status_idx" ON "invoices" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "invoices_owner_project_idx" ON "invoices" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_owner_enabled_idx" ON "bank_accounts" USING btree ("owner_id","is_enabled");--> statement-breakpoint
CREATE INDEX "bank_connections_owner_idx" ON "bank_connections" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");
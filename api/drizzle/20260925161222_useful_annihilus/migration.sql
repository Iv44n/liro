CREATE TABLE "accounts" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"value" double precision NOT NULL,
	"threshold" double precision NOT NULL,
	"details" jsonb,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"notify_error" text
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"template_id" text,
	"metric" text NOT NULL,
	"threshold" double precision NOT NULL,
	"window_minutes" integer DEFAULT 60 NOT NULL,
	"min_runs" integer DEFAULT 20 NOT NULL,
	"channel" text NOT NULL,
	"target" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikeys" (
	"id" text PRIMARY KEY,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "decision_runs" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version_id" text NOT NULL,
	"definition_hash" text NOT NULL,
	"engine_version" text NOT NULL,
	"mode" text NOT NULL,
	"source" text NOT NULL,
	"api_key_id" text,
	"user_id" text,
	"metadata" jsonb,
	"status" text NOT NULL,
	"input" jsonb,
	"policy_input" jsonb NOT NULL,
	"answers" jsonb,
	"signals" jsonb,
	"definition" jsonb,
	"decision" text,
	"suggestion" text,
	"confidence" double precision,
	"rule" text,
	"review_reason" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"final_decision" text,
	"error_code" text,
	"error_message" text,
	"provider" text,
	"model_requested" text,
	"model_resolved" text,
	"provider_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"evaluator_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decision_template_versions" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"major" integer,
	"minor" integer,
	"status" text NOT NULL,
	"definition" jsonb NOT NULL,
	"input_json_schema" jsonb,
	"definition_hash" text NOT NULL,
	"model_ref" jsonb NOT NULL,
	"changelog" text,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_templates" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"store_input" text DEFAULT 'full' NOT NULL,
	"retention_days" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "effect_bindings" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"on" text NOT NULL,
	"major" integer,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"include_input" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "effect_executions" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"binding_id" text,
	"endpoint_id" text,
	"template_id" text NOT NULL,
	"type" text NOT NULL,
	"event" text NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"last_response_status" integer,
	"last_response_body" text,
	"last_duration_ms" integer,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" text,
	"key" text,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"organization_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL UNIQUE,
	"template_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"suggested_decision" text,
	"allowed_decisions" text[] NOT NULL,
	"resolved_decision" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"comment" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"organization_id" text,
	"day" date,
	"template_id" text,
	"source" text,
	"mode" text,
	"provider" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"evaluations" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_pkey" PRIMARY KEY("organization_id","day","template_id","source","mode","provider")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"previous_secret_encrypted" text,
	"previous_secret_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "alert_events_org_rule_triggered_idx" ON "alert_events" ("organization_id","rule_id","triggered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alert_rules_org_enabled_idx" ON "alert_rules" ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "apikeys_configId_idx" ON "apikeys" ("config_id");--> statement-breakpoint
CREATE INDEX "apikeys_referenceId_idx" ON "apikeys" ("reference_id");--> statement-breakpoint
CREATE INDEX "apikeys_key_idx" ON "apikeys" ("key");--> statement-breakpoint
CREATE INDEX "decision_runs_org_template_created_idx" ON "decision_runs" ("organization_id","template_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decision_runs_org_created_idx" ON "decision_runs" ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decision_runs_org_decision_idx" ON "decision_runs" ("organization_id","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_template_versions_draft_uidx" ON "decision_template_versions" ("template_id") WHERE status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "decision_template_versions_number_uidx" ON "decision_template_versions" ("template_id","major","minor") WHERE status <> 'draft';--> statement-breakpoint
CREATE INDEX "decision_template_versions_org_template_idx" ON "decision_template_versions" ("organization_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_templates_org_slug_uidx" ON "decision_templates" ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "decision_templates_org_status_idx" ON "decision_templates" ("organization_id","status");--> statement-breakpoint
CREATE INDEX "effect_bindings_org_template_idx" ON "effect_bindings" ("organization_id","template_id");--> statement-breakpoint
CREATE INDEX "effect_executions_queued_run_at_idx" ON "effect_executions" ("run_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "effect_executions_org_created_idx" ON "effect_executions" ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "effect_executions_run_idx" ON "effect_executions" ("run_id");--> statement-breakpoint
CREATE INDEX "effect_executions_endpoint_created_idx" ON "effect_executions" ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "invitations_organizationId_idx" ON "invitations" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" ("email");--> statement-breakpoint
CREATE INDEX "jobs_queued_run_at_idx" ON "jobs" ("run_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_uidx" ON "jobs" ("dedupe_key") WHERE dedupe_key is not null and status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "members_organizationId_idx" ON "members" ("organization_id");--> statement-breakpoint
CREATE INDEX "members_userId_idx" ON "members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uidx" ON "organizations" ("slug");--> statement-breakpoint
CREATE INDEX "review_tasks_org_status_created_idx" ON "review_tasks" ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_template_id_decision_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_template_id_decision_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_version_id_decision_template_versions_id_fkey" FOREIGN KEY ("version_id") REFERENCES "decision_template_versions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_template_versions" ADD CONSTRAINT "decision_template_versions_OmK4jHJkr2YS_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_template_versions" ADD CONSTRAINT "decision_template_versions_66uGXtAkYApT_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_template_versions" ADD CONSTRAINT "decision_template_versions_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_template_versions" ADD CONSTRAINT "decision_template_versions_published_by_users_id_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_templates" ADD CONSTRAINT "decision_templates_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_templates" ADD CONSTRAINT "decision_templates_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "effect_bindings" ADD CONSTRAINT "effect_bindings_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "effect_bindings" ADD CONSTRAINT "effect_bindings_template_id_decision_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "effect_bindings" ADD CONSTRAINT "effect_bindings_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "effect_executions" ADD CONSTRAINT "effect_executions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "effect_executions" ADD CONSTRAINT "effect_executions_run_id_decision_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "decision_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "effect_executions" ADD CONSTRAINT "effect_executions_binding_id_effect_bindings_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "effect_bindings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "effect_executions" ADD CONSTRAINT "effect_executions_endpoint_id_webhook_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "effect_executions" ADD CONSTRAINT "effect_executions_template_id_decision_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_run_id_decision_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "decision_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_run_id_decision_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "decision_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_template_id_decision_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "decision_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_resolved_by_users_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
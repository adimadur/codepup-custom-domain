import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing NEON_DATABASE_URL");
}

// This is SAFE in serverless
export const sql = neon(databaseUrl);

// TABLE SCHEMA: `custom_domains`.
/*
[{
  "column_name": "updated_at",
  "data_type": "timestamp with time zone"
}, {
  "column_name": "required_dns",
  "data_type": "jsonb"
}, {
  "column_name": "fully_verified",
  "data_type": "boolean"
}, {
  "column_name": "created_at",
  "data_type": "timestamp with time zone"
}, {
  "column_name": "project_id",
  "data_type": "text"
}, {
  "column_name": "project_name",
  "data_type": "text"
}, {
  "column_name": "deployment_url",
  "data_type": "text"
}, {
  "column_name": "custom_domain",
  "data_type": "text"
}]
*/

// DB SCHEMA QUERY
/*
CREATE SCHEMA "public";
CREATE TABLE "custom_domains" (
	"project_id" text PRIMARY KEY,
	"project_name" text NOT NULL,
	"deployment_url" text NOT NULL,
	"custom_domain" text NOT NULL CONSTRAINT "custom_domains_custom_domain_key" UNIQUE,
	"required_dns" jsonb NOT NULL,
	"fully_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX "custom_domains_custom_domain_key" ON "custom_domains" ("custom_domain");
CREATE UNIQUE INDEX "custom_domains_pkey" ON "custom_domains" ("project_id");
*/
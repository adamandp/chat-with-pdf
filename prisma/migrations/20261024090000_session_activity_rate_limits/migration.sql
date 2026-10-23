ALTER TABLE "auth_sessions" ADD COLUMN "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "auth_sessions" SET "last_used_at" = "created_at";
CREATE TABLE "auth_rate_limits" (
  "key" VARCHAR(64) PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "reset_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "auth_rate_limits_reset_at_idx" ON "auth_rate_limits" ("reset_at");

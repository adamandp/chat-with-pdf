CREATE TABLE "auth_rate_limits" (
  "key" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL,
  "reset_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "auth_rate_limits_reset_at_idx" ON "auth_rate_limits"("reset_at");

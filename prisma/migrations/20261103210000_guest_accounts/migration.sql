CREATE TYPE "account_type" AS ENUM ('guest', 'registered');

ALTER TABLE "users"
ADD COLUMN "account_type" "account_type" NOT NULL DEFAULT 'registered';

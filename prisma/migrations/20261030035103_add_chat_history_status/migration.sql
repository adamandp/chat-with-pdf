/*
  Warnings:

  - The `status` column on the `chat_history` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "chat_history_status" AS ENUM ('pending', 'streaming', 'completed', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "chat_history" DROP COLUMN "status",
ADD COLUMN     "status" "chat_history_status" NOT NULL DEFAULT 'pending';

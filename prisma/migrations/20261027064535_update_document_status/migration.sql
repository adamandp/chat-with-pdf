/*
  Warnings:

  - The `status` column on the `documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `auth_rate_limits` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `document_jobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `document_uploads` table. If the table is not empty, all the data it contains will be lost.
  - Changed the type of `type` on the `chat_feedback` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "feedback_type" AS ENUM ('like', 'dislike');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('pending_upload', 'queued', 'processing', 'ready', 'failed', 'deleting', 'deleted');

-- DropForeignKey
ALTER TABLE "document_jobs" DROP CONSTRAINT "document_jobs_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_uploads" DROP CONSTRAINT "document_uploads_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_uploads" DROP CONSTRAINT "document_uploads_user_id_fkey";

-- AlterTable
ALTER TABLE "chat_feedback" DROP COLUMN "type",
ADD COLUMN     "type" "feedback_type" NOT NULL;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "file_path" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "document_status" NOT NULL DEFAULT 'pending_upload',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "auth_rate_limits";

-- DropTable
DROP TABLE "document_jobs";

-- DropTable
DROP TABLE "document_uploads";

-- DropEnum
DROP TYPE "FeedbackType";

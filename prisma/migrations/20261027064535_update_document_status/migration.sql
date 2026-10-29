
-- CreateEnum
CREATE TYPE "feedback_type" AS ENUM ('like', 'dislike');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM (
    'pending_upload',
    'queued',
    'processing',
    'ready',
    'failed',
    'deleting',
    'deleted'
);

-- DropForeignKey
-- Hanya hapus constraint jika tabelnya ada
DO $$
BEGIN
    IF to_regclass('public.document_jobs') IS NOT NULL THEN
        ALTER TABLE "document_jobs"
        DROP CONSTRAINT IF EXISTS "document_jobs_document_id_fkey";
    END IF;

    IF to_regclass('public.document_uploads') IS NOT NULL THEN
        ALTER TABLE "document_uploads"
        DROP CONSTRAINT IF EXISTS "document_uploads_document_id_fkey";

        ALTER TABLE "document_uploads"
        DROP CONSTRAINT IF EXISTS "document_uploads_user_id_fkey";
    END IF;
END $$;

-- AlterTable: chat_feedback
ALTER TABLE "chat_feedback"
    DROP COLUMN "type",
    ADD COLUMN "type" "feedback_type" NOT NULL;

-- AlterTable: documents
ALTER TABLE "documents"
    ALTER COLUMN "file_path" DROP NOT NULL,
    DROP COLUMN "status",
    ADD COLUMN "status" "document_status" NOT NULL DEFAULT 'pending_upload',
    ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE IF EXISTS "auth_rate_limits" CASCADE;
DROP TABLE IF EXISTS "document_jobs" CASCADE;
DROP TABLE IF EXISTS "document_uploads" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "FeedbackType";

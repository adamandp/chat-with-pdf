-- AlterTable
ALTER TABLE "chat_session" ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "chat_session_user_id_is_pinned_updated_at_idx" ON "chat_session"("user_id", "is_pinned", "updated_at");

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('LIKE', 'DISLIKE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(255),
    "password_hash" TEXT,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) DEFAULT 'New Chat',
    "answer_mode" VARCHAR(30) DEFAULT 'document_only',
    "active_leaf_message_id" UUID,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "chat_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_history" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "parent_message_id" UUID,
    "version_group_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "answer_mode" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "chat_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_feedback" (
    "id" SERIAL NOT NULL,
    "chat_history_id" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completions" (
    "id" UUID NOT NULL,
    "chat_history_id" UUID NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "input_cost" DECIMAL(12,8) DEFAULT 0,
    "output_cost" DECIMAL(12,8) DEFAULT 0,
    "total_cost" DECIMAL(12,8) DEFAULT 0,
    "latency_ms" INTEGER,
    "time_to_first_token_ms" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "sha256_hash" VARCHAR(64) NOT NULL,
    "page_count" INTEGER,
    "chunk_count" INTEGER DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_documents" (
    "session_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_documents_pkey" PRIMARY KEY ("session_id","document_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "chat_session_user_id_last_message_at_idx" ON "chat_session"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "chat_session_active_leaf_message_id_idx" ON "chat_session"("active_leaf_message_id");

-- CreateIndex
CREATE INDEX "chat_history_session_id_created_at_idx" ON "chat_history"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_history_parent_message_id_idx" ON "chat_history"("parent_message_id");

-- CreateIndex
CREATE INDEX "chat_history_version_group_id_idx" ON "chat_history"("version_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_feedback_chat_history_id_key" ON "chat_feedback"("chat_history_id");

-- CreateIndex
CREATE INDEX "completions_chat_history_id_idx" ON "completions"("chat_history_id");

-- CreateIndex
CREATE INDEX "documents_user_id_idx" ON "documents"("user_id");

-- CreateIndex
CREATE INDEX "documents_sha256_hash_idx" ON "documents"("sha256_hash");

-- CreateIndex
CREATE INDEX "session_documents_document_id_idx" ON "session_documents"("document_id");

-- AddForeignKey
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_active_leaf_message_id_fkey" FOREIGN KEY ("active_leaf_message_id") REFERENCES "chat_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "chat_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_chat_history_id_fkey" FOREIGN KEY ("chat_history_id") REFERENCES "chat_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completions" ADD CONSTRAINT "completions_chat_history_id_fkey" FOREIGN KEY ("chat_history_id") REFERENCES "chat_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_documents" ADD CONSTRAINT "session_documents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_documents" ADD CONSTRAINT "session_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the column `file_path` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `document_jobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `document_uploads` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "document_jobs" DROP CONSTRAINT "document_jobs_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_uploads" DROP CONSTRAINT "document_uploads_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_uploads" DROP CONSTRAINT "document_uploads_user_id_fkey";

-- DropIndex
DROP INDEX "users_email_key";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "file_path";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "email";

-- DropTable
DROP TABLE "document_jobs";

-- DropTable
DROP TABLE "document_uploads";

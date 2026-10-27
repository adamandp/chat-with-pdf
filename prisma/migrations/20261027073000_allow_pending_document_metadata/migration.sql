-- Metadata is populated after upload, when the backend processes the document.
ALTER TABLE "documents"
  ALTER COLUMN "filename" DROP NOT NULL,
  ALTER COLUMN "file_size" DROP NOT NULL,
  ALTER COLUMN "mime_type" DROP NOT NULL,
  ALTER COLUMN "sha256_hash" DROP NOT NULL;

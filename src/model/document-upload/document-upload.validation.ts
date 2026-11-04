import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';

export const PDF_MIME_TYPE = 'application/pdf';
const DEFAULT_MAX_PDF_BYTES = 20 * 1024 * 1024;

// Optional metadata keeps existing { fileName } clients working. The actual
// MinIO object and its bytes are independently checked before indexing.
export const presignUrlSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/\.pdf$/i),
  fileSize: z.number().int().positive().safe().optional(),
  mimeType: z.literal(PDF_MIME_TYPE).optional(),
  sha256Hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export function maxPdfBytes(config: ConfigService): number {
  const configured = config.get<string | number>(
    'MAX_PDF_BYTES',
    DEFAULT_MAX_PDF_BYTES,
  );
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('MAX_PDF_BYTES must be a positive safe integer');
  }
  return value;
}

export function assertPdfObject(
  object: { size: number; metaData?: Record<string, string> },
  limit: number,
  expectedSize?: bigint | null,
): void {
  if (!Number.isSafeInteger(object.size) || object.size <= 0) {
    throw new BadRequestException('Uploaded PDF is empty or has invalid size');
  }
  if (object.size > limit) {
    throw new BadRequestException(`PDF exceeds ${limit} byte upload limit`);
  }
  const contentType = Object.entries(object.metaData ?? {}).find(
    ([key]) => key.toLowerCase() === 'content-type',
  )?.[1];
  if (contentType?.split(';')[0].trim().toLowerCase() !== PDF_MIME_TYPE) {
    throw new BadRequestException(
      'Uploaded object must have application/pdf Content-Type',
    );
  }
  if (expectedSize != null && BigInt(object.size) !== expectedSize) {
    throw new BadRequestException(
      'Uploaded PDF size does not match declaration',
    );
  }
}

export function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(String(error.code));
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

@Injectable()
export class PdfService {
  constructor(private readonly config: ConfigService) {}

  get maxBytes(): number {
    return Number(this.config.get('MAX_PDF_BYTES', '20971520'));
  }

  validate(data: Buffer): string {
    if (data.length < 5 || data.length > this.maxBytes) {
      throw new BadRequestException('PDF is empty or exceeds the size limit');
    }

    if (data
      .subarray(0, 5)
      .toString() !== '%PDF-') {
      throw new BadRequestException('Invalid PDF');
    }

    return createHash('sha256')
      .update(data)
      .digest('hex');
  }

  async extract(
    data: Buffer,
    onPage?: (page: number, total: number) => Promise<void>,
  ) {
    const task = getDocument({
      data: new Uint8Array(data),
      useSystemFonts: true,
    });

    try {
      const pdf = await task.promise;

      if (pdf.numPages < 1 || pdf.numPages > 2000)
        throw new Error('Page limit exceeded');

      const pages: string[] = [];

      let characters = 0;

      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);

        const text = await page.getTextContent();

        const content = text.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join('');

        characters += content.length;

        if (characters > 30_000_000)
          throw new Error('Extracted text limit exceeded');

        pages.push(content);
        page.cleanup();

        await onPage?.(n, pdf.numPages);
      }

      return pages;
    } catch {
      throw new BadRequestException('Unreadable, encrypted, or oversized PDF');
    } finally {
      await task.destroy();
    }
  }
}

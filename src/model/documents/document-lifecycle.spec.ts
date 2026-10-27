import { Test } from '@nestjs/testing';
import { DocumentWorkerService } from './document-worker.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { PdfService } from './pdf.service';
import { VectorService } from './vector.service';
import { PinoLogger } from 'nestjs-pino';

describe('document processing through Nest lifecycle', () => {
  it('starts on application init and drains before shared clients shut down', async () => {
    let finished = false;

    const disconnected = vi.fn(() => {
      expect(finished)
        .toBe(true);
    });

    const module = await Test
      .createTestingModule({
        providers: [
          DocumentWorkerService,
          {
            provide: PrismaService,
            useValue: { onApplicationShutdown: disconnected },
          },
          {
            provide: DocumentsService,
            useValue: {},
          },
          {
            provide: PdfService,
            useValue: {},
          },
          {
            provide: VectorService,
            useValue: {},
          },
          {
            provide: PinoLogger,
            useValue: {
              setContext: vi.fn(),
              error: vi.fn(),
            },
          },
        ],
      })
      .compile();

    const worker = module.get(DocumentWorkerService);

    vi
      .spyOn(worker, 'claim')
      .mockResolvedValueOnce({
        id: 'job',
        documentId: 'doc',
        leaseId: 'lease',
        attempts: 1,
      });

    let finish!: () => void;

    const processing = vi
      .spyOn(worker, 'process')
      .mockReturnValue(new Promise<void>((resolve) => {
        finish = () => {
          finished = true;
          resolve();
        };
      }));

    await module.init();
    await vi.waitFor(() => expect(processing)
      .toHaveBeenCalledOnce());

    const closing = module.close();

    await Promise.resolve();
    expect(disconnected).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(disconnected)
      .toHaveBeenCalledOnce();
  });
});

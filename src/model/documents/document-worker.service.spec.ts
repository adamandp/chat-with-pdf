import { DocumentWorkerService } from './document-worker.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { PdfService } from './pdf.service';
import { VectorService } from './vector.service';
import { PinoLogger } from 'nestjs-pino';
import type { DocumentJob } from './documents.interface';

describe('in-process document processing', () => {
  function service() {
    return new DocumentWorkerService(
      {} as PrismaService,
      {} as DocumentsService,
      {} as PdfService,
      {} as VectorService,
      {
        setContext: vi.fn(),
        error: vi.fn(),
      } as unknown as PinoLogger,
    );
  }

  it('starts one consumer and drains the active job before stopping', async () => {
    const worker = service();

    const job: DocumentJob = {
      id: 'job',
      documentId: 'doc',
      leaseId: 'lease',
      attempts: 1,
    };

    const claim = vi
      .spyOn(worker, 'claim')
      .mockResolvedValueOnce(job)
      .mockResolvedValue(undefined);

    let finish!: () => void;

    const process = vi
      .spyOn(worker, 'process')
      .mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(process)
      .toHaveBeenCalledOnce());

    let stopped = false;

    const stopping = worker
      .stop()
      .then(() => {
        stopped = true;
      });

    await Promise.resolve();
    expect(stopped)
      .toBe(false);
    finish();
    await stopping;
    expect(stopped)
      .toBe(true);
    expect(claim)
      .toHaveBeenCalledOnce();
  });

  it('can stop an idle consumer without waiting for its polling interval', async () => {
    const worker = service();

    vi
      .spyOn(worker, 'claim')
      .mockResolvedValue(undefined);
    worker.start();
    await worker.stop();
    await worker.stop();
  });
});

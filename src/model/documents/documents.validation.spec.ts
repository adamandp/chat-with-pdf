import { PresignSchema, UploadSchema } from './documents.validation';
import { ChatSchema } from '../chat/chat.validation';
describe('document and chat requests', () => {
  it('rejects path components and non-PDF filenames', () => {
    for (const filename of ['../a.pdf', 'a\\b.pdf', 'a.txt', 'a\u0000.pdf'])
      expect(PresignSchema.safeParse({ filename }).success).toBe(false);
    expect(PresignSchema.safeParse({ filename: 'CV Adam.pdf' }).success).toBe(
      true,
    );
  });
  it('rejects invalid identifiers, blank questions and unbounded selections', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(UploadSchema.safeParse({ upload_id: 'bad' }).success).toBe(false);
    expect(
      ChatSchema.safeParse({ question: ' ', document_ids: [id] }).success,
    ).toBe(false);
    expect(
      ChatSchema.safeParse({ question: 'Hi', document_ids: Array(11).fill(id) })
        .success,
    ).toBe(false);
  });
});

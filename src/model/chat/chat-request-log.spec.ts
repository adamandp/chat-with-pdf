import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chatRequestContext, writeChatRequest } from './chat-request-log';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(
        (path) => rm(
          path,
          {
            recursive: true,
            force: true,
          },
        ),
      ),
  );
});

describe(
  'chat request JSON files',
  () => {
    it(
      'groups calls by session without overwriting concurrent requests',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'chat-request-log-'));

        directories.push(root);

        const sessionA = randomUUID();

        const sessionB = randomUUID();

        const options = {
          model: 'fixture',
          temperature: 0,
          max_retries: 1,
          timeout_ms: 30000,
        };

        await Promise.all([
          sessionA,
          sessionA,
          sessionB,
        ].map((sessionId, index) => writeChatRequest(
          root,
          {
            sessionId,
            turnId: String(index),
            mode: 'quick',
          },
          'answer',
          {
            system: 'Use evidence.',
            input: {
              question: `Question ${index}`,
              history: [],
              evidence: [],
            },
          },
          options,
        )));

        const filesA = await readdir(join(root, sessionA));

        expect(filesA)
          .toHaveLength(2);
        expect(await readdir(join(root, sessionB)))
          .toHaveLength(1);

        const requests = await Promise.all(
          filesA.map(
            async (file) => JSON.parse(
              await readFile(
                join(
                  root,
                  sessionA,
                  file,
                ),
                'utf8',
              ),
            ),
          ),
        );

        expect(requests
          .map((request) => request.request.input.question)
          .sort())
          .toEqual(
            [
              'Question 0',
              'Question 1',
            ],
          );
        expect(
          requests.every(
            (request) => request.session_id === sessionA && request.representation === 'langchain_input',
          ),
        )
          .toBe(
            true,
          );
        expect((await stat(join(
          root,
          sessionA,
          filesA[0],
        ))).mode & 0o777)
          .toBe(
            0o600,
          );
      },
    );

    it(
      'rejects path components that are not chat session UUIDs or supported operations',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'chat-request-log-'));

        directories.push(root);

        const options = {
          model: 'fixture',
          temperature: 0,
          max_retries: 1,
          timeout_ms: 30000,
        };

        await expect(writeChatRequest(
          root,
          {
            sessionId: '../escape',
            turnId: 'turn',
            mode: 'pro',
          },
          'answer',
          {
            system: '',
            input: {},
          },
          options,
        )).rejects.toThrow('Invalid chat session ID');

        await expect(writeChatRequest(
          root,
          {
            sessionId: randomUUID(),
            turnId: 'turn',
            mode: 'pro',
          },
          '../answer',
          {
            system: '',
            input: {},
          },
          options,
        )).rejects.toThrow('Invalid chat operation');

        expect(await readdir(root))
          .toEqual([]);
      },
    );

    it(
      'keeps asynchronous request contexts isolated and cleans up after a turn',
      async () => {
        const sessions = [
          randomUUID(),
          randomUUID(),
        ];

        const actual = await Promise.all(sessions.map((sessionId) => chatRequestContext.run(
          {
            sessionId,
            turnId: randomUUID(),
            mode: 'ultra',
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));

            return chatRequestContext.getStore()?.sessionId;
          },
        )));

        expect(actual)
          .toEqual(sessions);
        expect(chatRequestContext.getStore())
          .toBeUndefined();
      },
    );
  },
);

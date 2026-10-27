// bun run build, start postman/simulations/chat.sim.yaml on port 14901, then run with Bun.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ConfigService } = require('@nestjs/config');
const { AiService } = require('../../dist/common/ai/ai.service');
const { ChatModelService } = require('../../dist/model/chat/chat-model.service');
const { chatRequestContext } = require('../../dist/model/chat/chat-request-log');

(async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-thinking-'));
  try {
    const config = new ConfigService({
      GEMINI_API_KEY: 'simulation-key', GEMINI_CHAT_MODEL: 'gemini-test',
      GEMINI_CHAT_BASE_URL: 'http://127.0.0.1:14901/chat-model',
      CHAT_DEBUG_REQUESTS: 'true', CHAT_DEBUG_REQUESTS_DIR: root,
    });
    const model = new ChatModelService(new AiService(config), config, {
      trace() {}, warn() { throw new Error('Request log write failed'); },
    });
    const levels = { quick: 'LOW', pro: 'MEDIUM', ultra: 'HIGH' };
    // Concurrent calls also verify that thinking settings do not leak between modes.
    await Promise.all(Object.entries(levels).map(async ([mode, level]) => {
      const sessionId = randomUUID();
      const result = await chatRequestContext.run({ sessionId, mode, turnId: randomUUID() }, () =>
        model.answer(`EXPECT_THINKING_${level}`, [{
          id: 'chunk-1', document_id: randomUUID(), user_id: randomUUID(),
          filename: 'bonds.pdf', page: 1, text: 'Inflation is a risk.',
        }], null));
      assert(result.answer);
      const files = await readdir(join(root, sessionId));
      assert.equal(files.length, 1);
      const request = JSON.parse(await readFile(join(root, sessionId, files[0]), 'utf8'));
      assert.equal(request.mode, mode);
      assert.equal(request.options.thinking_config.thinkingLevel, level);
    }));
    console.log('PASS: LOW/MEDIUM/HIGH sent through real LangChain HTTP, per-session JSON and concurrent mode isolation');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

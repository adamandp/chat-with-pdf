// Run after bun run build, with postman/simulations/chat.sim.yaml on port 14901.
require('dotenv/config');
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, readdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { ZodValidationPipe } = require('nestjs-zod');
const { PinoLogger } = require('nestjs-pino');
const { ChatController } = require('../../dist/model/chat/chat.controller');
const { ChatService } = require('../../dist/model/chat/chat.service');
const { ChatRepository } = require('../../dist/model/chat/chat.repository');
const { ChatModelService } = require('../../dist/model/chat/chat-model.service');
const { VectorService } = require('../../dist/model/documents/processing/vector.service');
const { PrismaService } = require('../../dist/common/prisma/prisma.service');
const { MilvusService } = require('../../dist/common/milvus/milvus.service');
const { AiService } = require('../../dist/common/ai/ai.service');

(async () => {
  const requestLogRoot = await mkdtemp(join(tmpdir(), 'chat-integration-requests-'));
  const config = new ConfigService({
    ...process.env,
    GEMINI_API_KEY: 'simulation-key', GEMINI_CHAT_MODEL: 'gemini-test',
    GEMINI_CHAT_BASE_URL: 'http://127.0.0.1:14901/chat-model',
    GEMINI_EMBEDDING_BASE_URL: 'http://127.0.0.1:14901/gemini',
    EMBEDDING_DIMENSIONS: '1536', CHAT_MODEL_TIMEOUT_MS: '5000',
    CHAT_DEBUG_REQUESTS: 'true', CHAT_DEBUG_REQUESTS_DIR: requestLogRoot,
  });
  const prisma = new PrismaService(config);
  let app, owner, doc;
  let empty = false;
  const traceEvents = [];
  const warnings = [];
  const requestLogs = async sessionId => Promise.all(
    (await readdir(join(requestLogRoot, sessionId))).map(async name =>
      JSON.parse(await readFile(join(requestLogRoot, sessionId, name), 'utf8'))),
  );
  const milvus = {
    search: async ({ filter }) => {
      assert(filter.includes(owner.id));
      assert(filter.includes(doc.id));
      return {
        status: { error_code: 'Success' },
        results: empty ? [] : [{
          id: 'chunk-1', user_id: owner.id, document_id: doc.id,
          filename: 'bonds.pdf', page: 2, text: 'Inflation is a risk of bonds.',
        }],
      };
    },
  };
  try {
    await prisma.$connect();
    owner = await prisma.user.create({ data: { username: `chat-test-${randomUUID()}` } });
    doc = await prisma.document.create({ data: { userId: owner.id, status: 'READY', fileName: 'bonds.pdf' } });
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [ChatService, ChatRepository, ChatModelService, VectorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: AiService, useValue: new AiService(config) },
        { provide: MilvusService, useValue: milvus },
        { provide: PinoLogger, useValue: { setContext() {}, error() {}, warn(fields) { warnings.push(fields); }, trace(fields) { traceEvents.push(fields); } } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req, _res, next) => { req.user = { sub: req.headers['x-test-user'] || owner.id }; next(); });
    app.useGlobalPipes(new ZodValidationPipe());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const call = (body, user = owner.id, path = '/chat') => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    const body = { question: 'What are bonds?', document_ids: [doc.id, doc.id], mode: 'ultra' };
    assert.equal((await call({ ...body, question: '' })).status, 400);
    assert.equal((await call({ ...body, mode: 'medium' })).status, 400);
    assert.equal((await call(body, randomUUID())).status, 404);
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'PROCESSING' } });
    assert.equal((await call(body)).status, 409);
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'READY' } });
    const first = await call(body);
    const payload = await first.json();
    assert.equal(first.status, 201, JSON.stringify(payload));
    const sid = payload.data.session_id;
    const firstLogs = await requestLogs(sid);
    assert.deepEqual(firstLogs.map(log => log.operation).sort(), ['answer', 'evaluate']);
    assert.equal(new Set(firstLogs.map(log => log.turn_id)).size, 1);
    assert(firstLogs.every(log => log.session_id === sid && log.mode === 'ultra'));
    assert(firstLogs.every(log => log.representation === 'langchain_input'));
    assert(firstLogs.every(log => log.request.response_schema.properties));
    assert(firstLogs.every(log => log.request.input.question === body.question));
    assert(!JSON.stringify(firstLogs).includes('simulation-key'));
    assert.equal(payload.data.sources[0].document_id, doc.id);
    assert.equal(await prisma.chatHistory.count({ where: { sessionId: sid } }), 2);
    assert.equal(await prisma.sessionDocument.count({ where: { sessionId: sid } }), 1);
    const followup = { ...body, question: 'What are its risks?', session_id: sid };
    assert.equal((await call(followup)).status, 201);
    const history = await new ChatRepository(prisma).prepare(owner.id, [doc.id], sid);
    assert.equal(history.history.length, 4);
    assert.equal(history.history[2].content, followup.question);

    // Quick is the default; full messages survive compact context and mode switches.
    const quickBody = { ...body, mode: undefined, question: 'Stored complete: ' + 'x'.repeat(2000) };
    const quickResponse = await call(quickBody);
    assert.equal(quickResponse.status, 201);
    const quick = (await quickResponse.json()).data;
    const quickLogs = await requestLogs(quick.session_id);
    assert.deepEqual(quickLogs.map(log => log.operation), ['answer']);
    assert.equal(quickLogs[0].request.input.history.length, 0);
    assert.equal(quick.mode, 'quick');
    assert.equal(quick.search_attempts, 1);
    assert.equal(quick.context_sufficient, null);
    const compact = await new ChatRepository(prisma).prepare(owner.id, [doc.id], quick.session_id, 'quick');
    assert.equal(compact.history[0].content.length, 1000);
    const stored = await prisma.chatHistory.findFirst({ where: { sessionId: quick.session_id, role: 'user' } });
    assert.equal(stored.content, quickBody.question);
    for (let turn = 1; turn < 7; turn++) {
      assert.equal((await call({ ...quickBody, session_id: quick.session_id, question: `Question ${turn}` })).status, 201);
    }
    const expanded = await new ChatRepository(prisma).prepare(owner.id, [doc.id], quick.session_id, 'pro');
    assert.equal(expanded.history.length, 14);
    assert.equal(expanded.history[0].content, quickBody.question);
    const beforePro = traceEvents.length;
    const proResponse = await call({ ...body, session_id: quick.session_id, mode: 'pro', question: 'What are its risks? EXPECT_HISTORY_14' });
    assert.equal(proResponse.status, 201);
    const pro = (await proResponse.json()).data;
    assert.equal(pro.session_id, quick.session_id);
    assert.equal(pro.mode, 'pro');
    assert.equal(pro.search_attempts, 1);
    assert.equal(pro.context_sufficient, null);
    const proEvents = traceEvents.slice(beforePro);
    assert(!proEvents.some(event => event.operation === 'evaluate'));
    assert(proEvents.some(event => event.operation === 'answer' && event.historyMessages === 14));
    const proLogs = (await requestLogs(quick.session_id)).filter(log => log.mode === 'pro');
    assert.deepEqual(proLogs.map(log => log.operation).sort(), ['answer', 'rewrite']);
    assert.equal(new Set(proLogs.map(log => log.turn_id)).size, 1);
    assert(proLogs.every(log => log.request.input.history.length === 14));
    assert.equal(await prisma.chatHistory.count({ where: { sessionId: quick.session_id } }), 16);
    assert.equal((await call({ ...body, session_id: quick.session_id })).status, 201);

    // Long active branches stay bounded in model context without truncating stored messages.
    let parent = (await prisma.chatSession.findUnique({ where: { id: quick.session_id } })).activeLeafMessageId;
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      await prisma.chatHistory.create({ data: {
        id, sessionId: quick.session_id, parentMessageId: parent, versionGroupId: id,
        role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'y'.repeat(7998),
        status: 'completed', answerMode: 'document_only', sources: [],
      } });
      parent = id;
    }
    await prisma.chatSession.update({ where: { id: quick.session_id }, data: { activeLeafMessageId: parent } });
    const bounded = await new ChatRepository(prisma).prepare(owner.id, [doc.id], quick.session_id, 'pro');
    assert.equal(bounded.history.reduce((total, message) => total + message.content.length, 0), 64000);
    assert.equal(bounded.history.length, 8);
    assert(bounded.history[0].content.startsWith('2:'));
    assert(bounded.history.at(-1).content.startsWith('9:'));
    assert.equal(await prisma.chatHistory.count({ where: { sessionId: quick.session_id } }), 28);

    // Direct modes retain the SSE envelope but omit evaluator progress.
    for (const mode of ['quick', 'pro']) {
      const directStream = await call({ ...body, mode }, owner.id, '/chat/stream');
      assert.equal(directStream.status, 200);
      const directEvents = (await directStream.text()).trim().split('\n\n')
        .filter(frame => frame.startsWith('event:'))
        .map(frame => JSON.parse(frame.split('\n')[1].slice(6)));
      assert.deepEqual(directEvents.filter(event => event.type === 'progress').map(event => event.data.stage),
        ['preparing', 'searching', 'answering', 'saving']);
      assert.equal(directEvents.at(-1).type, 'done');
      assert.equal(directEvents.at(-1).data.mode, mode);
      assert.equal(directEvents.at(-1).data.context_sufficient, null);
    }

    const beforeDirectFailure = await prisma.chatHistory.count({ where: { session: { userId: owner.id } } });
    for (const mode of ['quick', 'pro']) {
      assert.equal((await call({ ...body, mode, question: 'SIMULATE_CHAT_FAILURE' })).status, 503);
      const quotaStream = await call({ ...body, mode, question: 'SIMULATE_CHAT_RATE_LIMIT' }, owner.id, '/chat/stream');
      assert.match(await quotaStream.text(), /"status_code":429/);
    }
    const directTimeout = await call({ ...body, mode: 'quick', question: 'SIMULATE_CHAT_TIMEOUT' });
    assert.equal(directTimeout.status, 504);
    assert.equal(await prisma.chatHistory.count({ where: { session: { userId: owner.id } } }), beforeDirectFailure);

    // Both requests share the same captured parent; only one may advance it.
    const repository = app.get(ChatRepository);
    const prepare = repository.prepare.bind(repository);
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let arrivals = 0;
    repository.prepare = async (...args) => {
      const result = await prepare(...args);
      if (++arrivals === 2) release();
      await barrier;
      return result;
    };
    const concurrent = await Promise.all([call(followup), call(followup)]);
    repository.prepare = prepare;
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.chatHistory.count({ where: { sessionId: sid } }), 6);

    const before = await prisma.chatHistory.count({ where: { session: { userId: owner.id } } });
    assert.equal((await call({ ...followup, question: 'SIMULATE_CHAT_FAILURE' })).status, 503);
    assert.equal(await prisma.chatHistory.count({ where: { session: { userId: owner.id } } }), before);
    const streamed = await call(body, owner.id, '/chat/stream');
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
    const streamText = await streamed.text();
    const frames = streamText.trim().split('\n\n').filter(frame => frame.startsWith('event:'));
    const events = frames.map(frame => ({
      event: frame.split('\n')[0].slice(7),
      data: JSON.parse(frame.split('\n')[1].slice(6)),
    }));
    assert.deepEqual(events.filter(event => event.event === 'progress').map(event => event.data.data.stage),
      ['preparing', 'searching', 'evaluating', 'answering', 'saving']);
    for (const event of events) {
      assert.equal(event.data.type, event.event);
      assert.deepEqual(Object.keys(event.data).sort(), ['data', 'type']);
    }
    const done = events.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(await prisma.chatHistory.count({ where: { sessionId: done.data.data.session_id } }), 2);
    assert.equal((await call(body, randomUUID(), '/chat/stream')).status, 404);
    assert.equal((await call({ ...body, question: '' }, owner.id, '/chat/stream')).status, 400);
    const failedStream = await call({ ...body, question: 'SIMULATE_CHAT_FAILURE' }, owner.id, '/chat/stream');
    assert.equal(failedStream.status, 200);
    const failedText = await failedStream.text();
    assert.match(failedText, /event: error/);
    assert.match(failedText, /"status_code":503/);
    assert(!failedText.includes('event: done'));
    const errorFrame = failedText.trim().split('\n\n').find(frame => frame.startsWith('event: error'));
    const errorPayload = JSON.parse(errorFrame.split('\n')[1].slice(6));
    assert.equal(errorPayload.type, 'error');
    assert.equal(errorPayload.data.status_code, 503);
    const beforeLimit = await prisma.chatHistory.count({ where: { session: { userId: owner.id } } });
    const limitedBody = { ...body, question: 'SIMULATE_CHAT_RATE_LIMIT' };
    const limited = await call(limitedBody);
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).message, /kuota/);
    const limitedStream = await call(limitedBody, owner.id, '/chat/stream');
    assert.equal(limitedStream.status, 200);
    const limitedText = await limitedStream.text();
    const limitedFrame = limitedText.trim().split('\n\n').find(frame => frame.startsWith('event: error'));
    const limitedPayload = JSON.parse(limitedFrame.split('\n')[1].slice(6));
    assert.equal(limitedPayload.type, 'error');
    assert.equal(limitedPayload.data.status_code, 429);
    assert.match(limitedPayload.data.message, /kuota/);
    assert(!limitedText.includes('event: done'));
    assert.equal(await prisma.chatHistory.count({ where: { session: { userId: owner.id } } }), beforeLimit);
    const timeoutStart = Date.now();
    const timedOut = await call({ ...body, question: 'SIMULATE_CHAT_TIMEOUT' }, owner.id, '/chat/stream');
    const timeoutText = await timedOut.text();
    assert.match(timeoutText, /"status_code":504/);
    assert(!timeoutText.includes('event: done'));
    assert(Date.now() - timeoutStart < 7500, 'model operation must end before the delayed fixture responds');
    assert.equal(await prisma.chatHistory.count({ where: { session: { userId: owner.id } } }), beforeLimit);
    empty = true;
    const fallback = await call(body);
    assert.equal(fallback.status, 201);
    const fallbackData = (await fallback.json()).data;
    assert.deepEqual(fallbackData.sources, []);
    assert.equal(fallbackData.context_sufficient, false);
    await prisma.chatSession.update({ where: { id: sid }, data: { deletedAt: new Date() } });
    assert.equal((await call(followup)).status, 404);
    assert(traceEvents.some(event => event.operation === 'evaluate' && event.event === 'started'));
    assert(traceEvents.some(event => event.operation === 'evaluate' && event.event === 'llm_response_received'));
    assert(traceEvents.some(event => event.operation === 'answer' && event.event === 'completed'));
    assert(traceEvents.some(event => event.event === 'failed' && event.errorType === 'TimeoutError'));
    const allRequestLogs = (await Promise.all((await readdir(requestLogRoot)).map(requestLogs))).flat();
    assert(allRequestLogs.some(log => log.request.input.question === 'SIMULATE_CHAT_TIMEOUT'));
    assert(allRequestLogs.some(log => log.request.input.question === 'SIMULATE_CHAT_FAILURE'));
    assert.equal(new Set(allRequestLogs.map(log => log.call_id)).size, allRequestLogs.length);
    assert.equal(warnings.length, 0);

    empty = false;
    config.set('CHAT_DEBUG_REQUESTS', 'false');
    const beforeDisabled = (await readdir(requestLogRoot)).length;
    assert.equal((await call({ ...body, mode: 'quick' })).status, 201);
    assert.equal((await readdir(requestLogRoot)).length, beforeDisabled);
    config.set('CHAT_DEBUG_REQUESTS', 'true');
    const blockedRoot = join(requestLogRoot, 'not-a-directory');
    await writeFile(blockedRoot, 'fixture');
    config.set('CHAT_DEBUG_REQUESTS_DIR', blockedRoot);
    assert.equal((await call({ ...body, mode: 'quick' })).status, 201);
    assert.equal(warnings.length, 1, 'failed debug writes should warn without failing the chat');
    console.log('PASS: quick/pro/ultra, history/mode switching, concurrency, 503/429/504, SSE, per-session request JSON including failures, logging opt-out and nonfatal write failures');
  } finally {
    if (app) await app.close();
    if (owner) {
      const sessions = { userId: owner.id };
      await prisma.chatSession.updateMany({ where: sessions, data: { activeLeafMessageId: null } });
      await prisma.chatHistory.deleteMany({ where: { session: sessions } });
      await prisma.sessionDocument.deleteMany({ where: { session: sessions } });
      await prisma.chatSession.deleteMany({ where: sessions });
      await prisma.document.deleteMany({ where: { userId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
    await prisma.$disconnect();
    await rm(requestLogRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

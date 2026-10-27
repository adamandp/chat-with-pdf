// Gemini generateContent wire contract; fixtures exercise the application's prompts.
const http = require('node:http');
http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST' || !/^\/v1beta\/models\/[^/:]+:generateContent$/.test(req.url.split('?')[0])) {
    return send(501, { error: { message: 'Endpoint not modeled' } });
  }
  const input = JSON.stringify(req.body?.contents || []);
  if (input.includes('SIMULATE_CHAT_TIMEOUT')) {
    return setTimeout(() => send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'Delayed fixture' } }), 8000);
  }
  if (input.includes('SIMULATE_CHAT_RATE_LIMIT')) {
    return send(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for simulation' } });
  }
  if (input.includes('SIMULATE_CHAT_FAILURE')) {
    return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'Simulated provider failure' } });
  }
  const system = JSON.stringify(req.body?.systemInstruction || {});
  const payload = JSON.parse(req.body.contents[0].parts[0].text);
  const expectedThinking = payload.question?.match(/EXPECT_THINKING_(LOW|MEDIUM|HIGH)/)?.[1];
  if (expectedThinking && req.body.generationConfig?.thinkingConfig?.thinkingLevel !== expectedThinking) {
    return send(400, { error: { code: 400, message: 'Incorrect thinking level in Gemini HTTP request' } });
  }
  if (payload.evidence && payload.evidence.some(chunk =>
    Object.keys(chunk).sort().join(',') !== 'source_id,text')) {
    return send(400, { error: { code: 400, message: 'Unexpected evidence metadata in model input' } });
  }
  if (payload.question?.includes('EXPECT_HISTORY_14') &&
      (payload.history?.length !== 14 || !payload.history[0].content.endsWith('x'.repeat(2000)))) {
    return send(400, { error: { code: 400, message: 'Full pro history did not reach the model' } });
  }
  let text;
  if (system.includes('Rewrite')) text = payload.question.includes('EXPECT_HISTORY_14')
    ? payload.question : 'What are the risks of bonds?';
  else if (system.includes('EVERY')) text = JSON.stringify({ enough: true, next_query: '' });
  else text = JSON.stringify({ answer: 'Inflation is a risk of bonds [1].', source_ids: [1] });
  send(200, {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 },
  });
}).listen(process.env.PORT);

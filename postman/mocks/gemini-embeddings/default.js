// Contract: https://ai.google.dev/api/embeddings#method:-models.batchembedcontents
const http = require('node:http');
http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST' || !/^\/v1beta\/models\/[^/]+:batchEmbedContents$/.test(req.url.split('?')[0])) {
    return send(501, { error: { message: 'Endpoint not modeled' } });
  }
  const requests = req.body?.requests;
  if (!Array.isArray(requests) || !requests.length || requests.some(r => !r.content?.parts?.some(p => typeof p.text === 'string'))) {
    return send(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid embedding request' } });
  }
  if (requests.some(r => r.content.parts.some(p => p.text?.includes('SIMULATE_EMBED_FAILURE')))) {
    return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'Simulated provider failure' } });
  }
  send(200, { embeddings: requests.map(r => ({ values: Array.from({ length: r.outputDimensionality || 1536 }, (_, i) => i === 0 ? 1 : 0) })) });
}).listen(process.env.PORT);

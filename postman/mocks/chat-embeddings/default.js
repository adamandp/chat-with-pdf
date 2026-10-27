// Gemini embedContent contract used by LangChain embedQuery.
const http = require('node:http');
http.createServer((req, res) => {
  const valid = req.method === 'POST'
    && /^\/v1beta\/models\/[^/:]+:embedContent$/.test(req.url.split('?')[0])
    && req.body?.content?.parts?.some(part => typeof part.text === 'string');
  res.writeHead(valid ? 200 : 501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(valid
    ? { embedding: { values: Array.from({ length: req.body.outputDimensionality || 1536 }, (_, i) => i === 0 ? 1 : 0) } }
    : { error: { message: 'Endpoint not modeled' } }));
}).listen(process.env.PORT);

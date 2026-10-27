// S3 GET/HEAD object subset exercised by the real MinIO client. No auth verification.
const http = require('node:http');
function pdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(501); return res.end(); }
  const data = req.url.includes('000000000002') ? Buffer.from('not a pdf')
    : pdf(req.url.includes('000000000003') ? ' ' : req.url.includes('000000000004') ? 'SIMULATE_EMBED_FAILURE' : 'Document processing integration test.');
  res.writeHead(200, {
    'Content-Type': 'application/pdf', 'Content-Length': data.length,
    'Last-Modified': 'Tue, 27 Oct 2026 00:00:00 GMT', ETag: '"test-etag"',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}).listen(process.env.PORT);

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { handleRequest } = require('./server.js');

test('integration: proxy health check', async (t) => {
  const server = http.createServer(handleRequest);
  
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  const res = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, resolve);
    req.on('error', reject);
  });

  let data = '';
  for await (const chunk of res) {
    data += chunk;
  }

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(data, 'OK');

  await new Promise((resolve) => {
    server.close(resolve);
  });
});

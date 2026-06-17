#!/usr/bin/env node
import path from 'path';
import http from 'http';

const projRoot = 'd:/workSpace/AI__SPACE/lfc-00025';
const { default: app } = await import(
  `file:///${path.join(projRoot, 'api', 'app.ts').replace(/\\/g, '/')}`
);

const server = app.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`listen OK: port=${port}`);

  // 完全模拟 curl 风格的请求（和裸 TCP 时相同的 headers）
  const opts = {
    hostname: '127.0.0.1',
    port,
    path: '/api/sensors',
    method: 'GET',
    headers: {
      'Host': `127.0.0.1',
      'Connection': 'close',
    },
    agent: false,  // 不使用 keep-alive
  };
  console.log('making http.request with opts:', opts);
  const t0 = Date.now();
  const req = http.request(opts, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      const dt = Date.now() - t0;
      console.log(`HTTP OK dt=${dt}ms status=${res.statusCode} headers=`, res.headers);
      console.log('BODY first 300:', data.substring(0, 300));
      const body = JSON.parse(data);
      console.log(`sensors count: ${body.data?.length}`);
      server.close(() => process.exit(0));
    });
  });
  req.on('error', (e) => { console.error('HTTP REQUEST ERROR', e); server.close(() => process.exit(1)); });
  req.setTimeout(10000, () => { console.error('HTTP TIMEOUT after 10s'); req.destroy(); server.close(() => process.exit(1)); });
  req.end();
  console.log('request sent');
});

setTimeout(() => {
  console.error('LISTEN TIMEOUT');
  process.exit(1);
}, 15000);

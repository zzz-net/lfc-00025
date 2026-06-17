#!/usr/bin/env node
import http from 'http';

const t0 = Date.now();
const req = http.request({
  hostname: '127.0.0.1', port: 3001, path: '/api/health', method: 'GET',
  headers: { 'Connection': 'close' },
  agent: false,
}, (res) => {
  let d = '';
  res.on('data', (c) => d += c);
  res.on('end', () => {
    console.log(`OK: dt=${Date.now() - t0}ms status=${res.statusCode} body=${d.substring(0, 200)}`);
    process.exit(0);
  });
});
req.on('error', (e) => { console.error('ERROR:', e.message); process.exit(1); });
req.setTimeout(5000, () => { console.error('TIMEOUT after 5s'); req.destroy(); process.exit(1); });
req.end();

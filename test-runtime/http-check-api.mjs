#!/usr/bin/env node
// 用户要求：不要把 HTTP 方法当 shell 命令跑，用测试脚本验证接口
import http from 'http';

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = http.request(urlStr, { agent: false, headers: { Connection: 'close' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('TIMEOUT')); });
    req.end();
  });
}

const t0 = Date.now();
const resp = await httpGet('http://127.0.0.1:3001/api/sensors');
console.log(`status=${resp.status} dt=${Date.now() - t0}ms`);
const body = JSON.parse(resp.body);
console.log(`success=${body.success} sensors=${body.data?.length}`);
for (const s of body.data || []) {
  // 打印所有字段，排查是不是字段名错了
  console.log(`  ${s.id.padEnd(10)} keys=[${Object.keys(s).join(',')}]  → R=${s.readingCount ?? '?'} A=${s.anomalyCount ?? '?'} P=${s.pendingCount ?? '?'}`);
  if (s.readingCount >= 1_000_000 || s.anomalyCount >= 1_000_000) {
    console.log('    ❌ STILL MILLION-LEVEL!!!');
    process.exitCode = 1;
  }
}

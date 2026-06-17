#!/usr/bin/env node
// HTTP API 验证（只读 HTTP 响应，不连 DB，避免多进程互锁）
import http from 'http';

function httpGetRaw(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'GET', agent: false, headers: { Connection: 'close' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('TIMEOUT_15S')); });
    req.end();
  });
}

const t0 = Date.now();
console.log('GET /api/sensors via HTTP...');
const resp = await httpGetRaw('http://127.0.0.1:3001/api/sensors');
console.log(`status=${resp.status} dt=${Date.now() - t0}ms`);

const body = JSON.parse(resp.body);
console.log(`success=${body.success} count=${body.data?.length}`);

for (const s of body.data || []) {
  const million = (s.readingCount >= 1_000_000 || s.anomalyCount >= 1_000_000 || s.pendingCount >= 1_000_000);
  const zeroAll = (s.readingCount === 0 && s.anomalyCount === 0 && s.pendingCount === 0);
  console.log(
    `  ${String(s.id).padEnd(10)} ` +
    `RC=${String(s.readingCount ?? 'null').padStart(8)} ` +
    `AC=${String(s.anomalyCount ?? 'null').padStart(6)} ` +
    `PC=${String(s.pendingCount ?? 'null').padStart(6)} ` +
    `${million ? '❌ MILLION' : ''}${zeroAll ? '❌ ALL_ZERO' : ''}${!million && !zeroAll ? '✅' : ''}`
  );
}

// 预期：SENS-001~005 有几千读数、几百异常；不能百万；不能全 0
const allZero = (body.data || []).every(s => s.readingCount === 0);
if (allZero) { console.log('\n❌ 所有传感器 readingCount 都是 0！字段映射或 SQL 有问题'); process.exitCode = 1; }
const anyMillion = (body.data || []).some(s => s.readingCount >= 1_000_000 || s.anomalyCount >= 1_000_000);
if (anyMillion) { console.log('\n❌ 仍有百万级数字！修复未生效'); process.exitCode = 1; }
if (!allZero && !anyMillion) console.log('\n✅ 数字正常：几千条量级，无百万，无全 0');

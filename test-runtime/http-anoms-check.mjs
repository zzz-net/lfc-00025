#!/usr/bin/env node
// 只用 HTTP 查 /api/anomalies 数量
import http from 'http';
function req(path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: 3001, path, method: 'GET', agent: false, headers: { Connection: 'close' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(new Error('TO8s')); });
    r.end();
  });
}

// 查 /api/anomalies (无参，ALL)
const t0 = Date.now();
const r1 = await req('/api/anomalies');
console.log(`/api/anomalies dt=${Date.now() - t0}ms status=${r1.status} bytes=${r1.body.length}`);
const j1 = JSON.parse(r1.body);
console.log(`  anomalies count=${j1.data?.length ?? 'N/A'}`);
if (j1.data) for (const a of j1.data.slice(0, 5)) console.log(`    ${a.id} ${a.sensor_id} ${a.status} ${a.type}`);

// 查 /api/anomalies?status=PENDING
const r2 = await req('/api/anomalies?status=PENDING');
const j2 = JSON.parse(r2.body);
console.log(`  /api/anomalies?status=PENDING count=${j2.data?.length}`);

// 查 /api/anomalies?status=ALL
const r3 = await req('/api/anomalies?status=ALL');
const j3 = JSON.parse(r3.body);
console.log(`  /api/anomalies?status=ALL count=${j3.data?.length}`);

// 查 /api/anomalies?sensorId=SENS-003
const r4 = await req('/api/anomalies?sensorId=SENS-003');
const j4 = JSON.parse(r4.body);
console.log(`  /api/anomalies?sensorId=SENS-003 count=${j4.data?.length}`);

// 统计 sensors 返回的 anomalyCount 总和
const rs = await req('/api/sensors');
const js = JSON.parse(rs.body);
const sum = js.data.reduce((a, s) => a + s.anomalyCount, 0);
console.log(`\nSENSORS anomalyCount SUM = ${sum} (这应该是 anomaly 总数，按 SensorRepo 统计逻辑)`);

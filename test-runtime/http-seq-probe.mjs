#!/usr/bin/env node
import http from 'http';
function req(path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: 3001, path, method: 'GET', agent: false, headers: { Connection: 'close' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0, 300) }));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => { r.destroy(new Error('TO5s')); });
    r.end();
  });
}
console.log('A) /api/health...');
try { const r = await req('/api/health'); console.log('  health:', JSON.stringify(r)); } catch (e) { console.log('  health ERR:', e.message); }
console.log('B) /api/anomalies/thresholds...');
try { const r = await req('/api/anomalies/thresholds'); console.log('  thresholds:', JSON.stringify(r)); } catch (e) { console.log('  th ERR:', e.message); }
console.log('C) /api/sensors...');
const t0 = Date.now();
try { const r = await req('/api/sensors'); console.log(`  sensors dt=${Date.now() - t0}ms:`, JSON.stringify(r)); } catch (e) { console.log(`  sensors ERR dt=${Date.now() - t0}ms:`, e.message); }

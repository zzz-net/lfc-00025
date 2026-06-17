#!/usr/bin/env node
// 单独开进程打开 data/qc_sensors.db，不与后端共享任何连接，测 SQL 耗时
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = 'd:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db';
const db = new Database(dbPath, { readonly: true });

console.log('DB open OK (readonly, independent process)');

const gt = db.prepare(`
  SELECT s.id,
    (SELECT COUNT(*) FROM readings r WHERE r.sensor_id = s.id) gt_r,
    (SELECT COUNT(*) FROM anomalies a WHERE a.sensor_id = s.id) gt_a
  FROM sensors s ORDER BY s.name
`).all();
console.log('GT (subquery):');
for (const r of gt) console.log(`  ${r.id.padEnd(10)} R=${r.gt_r} A=${r.gt_a}`);

const t0 = Date.now();
const rows = db.prepare(`
  SELECT s.*,
    COUNT(DISTINCT r.id) as reading_count,
    COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND (ann.status IS NULL OR ann.status = 'DETECTED' OR ann.rolled_back_at IS NOT NULL) THEN a.id END) as anomaly_count,
    COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND (ann.status = 'PENDING' OR ann.status IS NULL) THEN a.id END) as pending_count
  FROM sensors s
  LEFT JOIN readings r ON r.sensor_id = s.id
  LEFT JOIN anomalies a ON a.sensor_id = s.id
  LEFT JOIN (
    SELECT anomaly_id, status, MAX(created_at) as latest, rolled_back_at
    FROM annotations
    GROUP BY anomaly_id
  ) ann ON ann.anomaly_id = a.id
  GROUP BY s.id
  ORDER BY s.name
`).all();
const dt = Date.now() - t0;

console.log(`\nCOUNT(DISTINCT) SQL took ${dt}ms:`);
for (const r of rows) {
  console.log(`  ${String(r.id).padEnd(10)} R=${r.reading_count} A=${r.anomaly_count} P=${r.pending_count}`);
  const g = gt.find(x => x.id === r.id);
  if (r.reading_count !== g.gt_r) console.log('    ❌ reading_count mismatch!');
}

// 再跑一次看缓存
const t1 = Date.now();
db.prepare(`SELECT COUNT(*) FROM sensors`).get();
const t2 = Date.now();
console.log(`\nSimple COUNT took ${t2 - t1}ms`);

db.close();
console.log('\n✅ Independent process SQL check complete (no lock, no sharing)');

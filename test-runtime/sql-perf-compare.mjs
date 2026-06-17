#!/usr/bin/env node
// 验证两种新 SQL 方案：速度 + 正确性（都要和子查询 COUNT(*) GT 对齐）
import Database from 'better-sqlite3';

const dbPath = 'd:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db';
const db = new Database(dbPath, { readonly: true });

// 先取 GT（子查询 COUNT(*)）
const GT = db.prepare(`
  SELECT s.*,
    (SELECT COUNT(*) FROM readings r WHERE r.sensor_id = s.id) gt_r,
    (SELECT COUNT(*) FROM anomalies a WHERE a.sensor_id = s.id
      AND (
        COALESCE((SELECT ann.status FROM annotations ann
                  WHERE ann.anomaly_id = a.id
                  ORDER BY ann.created_at DESC LIMIT 1), null) IS NULL
        OR COALESCE((SELECT ann.status FROM annotations ann
                      WHERE ann.anomaly_id = a.id
                      ORDER BY ann.created_at DESC LIMIT 1), null) = 'DETECTED'
        OR COALESCE((SELECT ann.rolled_back_at FROM annotations ann
                      WHERE ann.anomaly_id = a.id
                      ORDER BY ann.created_at DESC LIMIT 1), null) IS NOT NULL
      )) gt_a,
    (SELECT COUNT(*) FROM anomalies a WHERE a.sensor_id = s.id
      AND (
        COALESCE((SELECT ann.status FROM annotations ann
                  WHERE ann.anomaly_id = a.id
                  ORDER BY ann.created_at DESC LIMIT 1), null) = 'PENDING'
        OR COALESCE((SELECT ann.status FROM annotations ann
                      WHERE ann.anomaly_id = a.id
                      ORDER BY ann.created_at DESC LIMIT 1), null) IS NULL
      )) gt_p
  FROM sensors s ORDER BY s.name
`).all();
console.log('GT (逐行子查询 COUNT) — 作为基准');
for (const g of GT) console.log(`  ${g.id.padEnd(10)} R=${g.gt_r} A=${g.gt_a} P=${g.gt_p}`);

// 方案 B：JOIN 三个独立预聚合子查询（性能最佳，也是最终方案）
// 先构造 anomalies 聚合需要的每台传感器 anomaly_id 集合，然后分别算 anomaly_count 和 pending_count
const sqlB = `
  SELECT s.*,
    COALESCE(r.r_count, 0)       AS reading_count,
    COALESCE(anomaly.a_count, 0) AS anomaly_count,
    COALESCE(anomaly.p_count, 0) AS pending_count
  FROM sensors s
  LEFT JOIN (
    SELECT sensor_id, COUNT(*) as r_count
    FROM readings
    GROUP BY sensor_id
  ) r ON r.sensor_id = s.id
  LEFT JOIN (
    SELECT
      a.sensor_id,
      SUM(CASE WHEN (ann.status IS NULL OR ann.status = 'DETECTED' OR ann.rolled_back_at IS NOT NULL) THEN 1 ELSE 0 END) AS a_count,
      SUM(CASE WHEN (ann.status = 'PENDING' OR ann.status IS NULL) THEN 1 ELSE 0 END)                               AS p_count
    FROM anomalies a
    LEFT JOIN (
      SELECT anomaly_id, status, MAX(created_at) as latest, rolled_back_at
      FROM annotations
      GROUP BY anomaly_id
    ) ann ON ann.anomaly_id = a.id
    GROUP BY a.sensor_id
  ) anomaly ON anomaly.sensor_id = s.id
  ORDER BY s.name
`;

const tB0 = Date.now();
const rowsB = db.prepare(sqlB).all();
const tB = Date.now() - tB0;
console.log(`\n方案 B (JOIN 独立聚合子查询) — ${tB}ms`);
let okB = true;
for (let i = 0; i < GT.length; i++) {
  const g = GT[i], r = rowsB[i];
  const eq = (r.reading_count === g.gt_r) && (r.anomaly_count === g.gt_a) && (r.pending_count === g.gt_p);
  console.log(`  ${r.id.padEnd(10)} R=${r.reading_count} A=${r.anomaly_count} P=${r.pending_count}  ${eq ? '✅' : '❌ GT mismatch'}`);
  if (!eq) okB = false;
}
console.log(okB ? `\n✅ 方案 B 完全对齐 GT，且仅用 ${tB}ms` : '\n❌ 方案 B 有字段不对');

db.close();

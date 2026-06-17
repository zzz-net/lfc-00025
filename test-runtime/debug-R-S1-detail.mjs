#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('d:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db', { readonly: true });

// 单独跑 R-S1 anomaly 的 GT 逻辑
const a = db.prepare(`SELECT id FROM anomalies WHERE sensor_id = 'R-S1'`).get();
console.log('R-S1 anomaly id:', a.id);

const latest_ann = db.prepare(`
  SELECT id, status, rolled_back_at, created_at
  FROM annotations
  WHERE anomaly_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT 3
`).all(a.id);
console.log('latest ann:');
for (const l of latest_ann) console.log('  ', JSON.stringify(l));

const s1 = db.prepare(`SELECT ann.status FROM annotations ann WHERE ann.anomaly_id = ? ORDER BY ann.created_at DESC LIMIT 1`).get(a.id);
const s2 = db.prepare(`SELECT ann.rolled_back_at FROM annotations ann WHERE ann.anomaly_id = ? ORDER BY ann.created_at DESC LIMIT 1`).get(a.id);
console.log('subquery1 (status) =', s1);
console.log('subquery2 (rb) =', s2);

// 注意：两个子查询 LIMIT 1，会不会选到不同的行？（created_at 相同的 2 行）
// 检查：是否 LIMIT 1 在 created_at 同值时的选择是非确定的？
console.log('\n100 次重复查 status:');
const statuses = new Set();
for (let i = 0; i < 100; i++) {
  const x = db.prepare(`SELECT ann.status FROM annotations ann WHERE ann.anomaly_id = ? ORDER BY ann.created_at DESC LIMIT 1`).get(a.id);
  statuses.add(x.status);
}
console.log('  seen status:', [...statuses]); // 会不会同时出现 ACCEPTED 和 FALSE_POSITIVE？

db.close();

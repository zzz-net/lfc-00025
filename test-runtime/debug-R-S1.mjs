#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('d:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db', { readonly: true });

console.log('R-S1 anomalies + latest annotation:');
const anns = db.prepare(`
  SELECT a.id, a.sensor_id,
    (SELECT status FROM annotations ann WHERE ann.anomaly_id = a.id ORDER BY created_at DESC LIMIT 1) latest_status,
    (SELECT rolled_back_at FROM annotations ann WHERE ann.anomaly_id = a.id ORDER BY created_at DESC LIMIT 1) latest_rb
  FROM anomalies a WHERE a.sensor_id = 'R-S1'
`).all();
for (const a of anns) console.log('  ', a);

console.log('\nR-S2 anomalies + latest annotation:');
const anns2 = db.prepare(`
  SELECT a.id, a.sensor_id,
    (SELECT status FROM annotations ann WHERE ann.anomaly_id = a.id ORDER BY created_at DESC LIMIT 1) latest_status,
    (SELECT rolled_back_at FROM annotations ann WHERE ann.anomaly_id = a.id ORDER BY created_at DESC LIMIT 1) latest_rb
  FROM anomalies a WHERE a.sensor_id = 'R-S2'
`).all();
for (const a of anns2) console.log('  ', a);

db.close();

#!/usr/bin/env node
// 查真实 DB 的行数，确认量级
import Database from 'better-sqlite3';

const dbPath = 'd:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db';
const db = new Database(dbPath, { readonly: true });

const cnt = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
console.log('Row counts:');
console.log(`  sensors    = ${cnt('sensors')}`);
console.log(`  readings   = ${cnt('readings')}`);
console.log(`  anomalies  = ${cnt('anomalies')}`);
console.log(`  annotations= ${cnt('annotations')}`);

// 看看每个表的结构（有没有索引）
const idxs = db.prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'`).all();
console.log('\nIndexes:');
for (const i of idxs) console.log(`  ${i.tbl_name}: ${i.name}`);

// 看一下 annotations 有多少不同的 anomaly_id（GROUP BY 后多少行）
const g = db.prepare(`SELECT COUNT(*) c FROM (SELECT anomaly_id FROM annotations GROUP BY anomaly_id)`).get().c;
console.log(`\nannotations GROUP BY anomaly_id 之后行数 = ${g}`);
db.close();

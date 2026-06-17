#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('d:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db', { readonly: true });
const all = db.prepare(`SELECT * FROM annotations`).all();
console.log('All annotations (6 rows):');
for (const a of all) console.log('  ', JSON.stringify(a));
db.close();

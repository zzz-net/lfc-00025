#!/usr/bin/env node
import Database from 'better-sqlite3';
const db = new Database('d:/workSpace/AI__SPACE/lfc-00025/data/qc_sensors.db', { readonly: true });
console.log('sensors schema:');
console.log(db.prepare('PRAGMA table_info(sensors)').all());
console.log('\nanomalies schema:');
console.log(db.prepare('PRAGMA table_info(anomalies)').all().slice(0, 10));
console.log('\nannotations schema:');
console.log(db.prepare('PRAGMA table_info(annotations)').all());
db.close();

import { db } from '../api/data/db.js';
// db 在 import 时就按 QC_DATA_DIR/QC_DB_PATH 初始化好了，所以下面用它就行

const actualReadings = db.prepare('SELECT sensor_id, COUNT(*) as c FROM readings GROUP BY sensor_id').all();
const actualAnomalies = db.prepare('SELECT sensor_id, COUNT(*) as c FROM anomalies GROUP BY sensor_id').all();
console.log('=== SQLite 实际行数 ===');
console.log('readings 每台:', actualReadings);
console.log('anomalies 每台:', actualAnomalies);
console.log('readings 总计:', db.prepare('SELECT COUNT(*) as c FROM readings').get().c);
console.log('anomalies 总计:', db.prepare('SELECT COUNT(*) as c FROM anomalies').get().c);

console.log('\n=== 当前 findAllSensors 返回（有笛卡尔积bug） ===');
const buggy = db.prepare(`
  SELECT s.id, s.name,
    COUNT(r.id) as reading_count,
    COUNT(DISTINCT r.id) as reading_count_distinct,
    SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) as anomaly_count,
    COUNT(DISTINCT a.id) as anomaly_count_distinct
  FROM sensors s
  LEFT JOIN readings r ON r.sensor_id = s.id
  LEFT JOIN anomalies a ON a.sensor_id = s.id
  GROUP BY s.id
`).all();
console.log(buggy);

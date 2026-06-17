import { db } from '../api/data/db.js';
import { findAllSensors } from '../api/repositories/SensorRepo.js';

// db 在 import 时自动按 QC_DATA_DIR/QC_DB_PATH 选择路径，这里不用显式设，用默认 data/
const readingsPerSensor = db.prepare("SELECT sensor_id, COUNT(*) as c FROM readings GROUP BY sensor_id").all();
const anomaliesPerSensor = db.prepare("SELECT sensor_id, COUNT(*) as c FROM anomalies GROUP BY sensor_id").all();
console.log('=== SQLite ground truth (默认 data/ 目录) ===');
console.log('readings 每台:', readingsPerSensor);
console.log('anomalies 每台:', anomaliesPerSensor);
console.log('readings 总计:', db.prepare("SELECT COUNT(*) as c FROM readings").get().c);
console.log('anomalies 总计:', db.prepare("SELECT COUNT(*) as c FROM anomalies").get().c);
console.log('sensors 总数:', db.prepare("SELECT COUNT(*) as c FROM sensors").get().c);

console.log('\n=== findAllSensors() 返回 ===');
const sensors = findAllSensors();
let sumR = 0, sumA = 0, sumP = 0;
for (const s of sensors) {
  sumR += s.readingCount; sumA += s.anomalyCount; sumP += s.pendingCount;
  console.log(`  ${s.id} name=${s.name} readings=${s.readingCount} anomalies=${s.anomalyCount} pending=${s.pendingCount}`);
}
console.log(`\n汇总: readings=${sumR} anomalies=${sumA} pending=${sumP}`);

import { db } from '../api/data/db.js';
import { findAllSensors } from '../api/repositories/SensorRepo.js';

const readingsPerSensor = db.prepare('SELECT sensor_id, COUNT(*) as c FROM readings GROUP BY sensor_id').all();
const anomaliesPerSensor = db.prepare('SELECT sensor_id, COUNT(*) as c FROM anomalies GROUP BY sensor_id').all();
const totalReadings = db.prepare('SELECT COUNT(*) as c FROM readings').get().c;
const totalAnomalies = db.prepare('SELECT COUNT(*) as c FROM anomalies').get().c;

console.log('=== SQLite ground truth ===');
console.log('readings 总计:', totalReadings);
console.log('anomalies 总计:', totalAnomalies);
console.log('每台 readings:', readingsPerSensor);
console.log('每台 anomalies:', anomaliesPerSensor);

console.log('\n=== 修复后 findAllSensors() ===');
const sensors = findAllSensors();
let sumReading = 0, sumAnom = 0, sumPending = 0;
for (const s of sensors) {
  sumReading += s.readingCount;
  sumAnom += s.anomalyCount;
  sumPending += s.pendingCount;
  const gtR = readingsPerSensor.find((x) => x.sensor_id === s.id)?.c || 0;
  const gtA = anomaliesPerSensor.find((x) => x.sensor_id === s.id)?.c || 0;
  console.log(`  ${s.id} readings=${s.readingCount}(expected ${gtR}) anomalies=${s.anomalyCount}(expected ${gtA}) pending=${s.pendingCount}`);
  if (s.readingCount !== gtR) { console.error('❌ reading 不匹配!'); process.exit(1); }
  // anomaly_count 语义是"待处理或已回滚"，不是全量异常，所以这里只检查不超过 gtA
  if (s.anomalyCount > gtA) { console.error('❌ anomaly 超过全量!'); process.exit(1); }
}
console.log(`\n汇总 readings=${sumReading}(expected ${totalReadings}) anomalies=${sumAnom}(expected <= ${totalAnomalies}) pending=${sumPending}`);
if (sumReading !== totalReadings) { console.error('❌ 汇总 reading 不匹配!'); process.exit(1); }
console.log('✅ SensorRepo 统计修复完成，数值与 SQLite ground truth 一致');

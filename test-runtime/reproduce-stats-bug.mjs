#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DataDb = await import(
  `file:///${path.join(projectRoot, 'api', 'data', 'db.ts').replace(/\\/g, '/')}?t=${Date.now()}`
);
const Sample = await import(
  `file:///${path.join(projectRoot, 'api', 'services', 'ImportService.ts').replace(/\\/g, '/')}?t=${Date.now()}`
);

const db = DataDb.db;

console.log('\n======== 复现脚本：笛卡尔积放大 bug =========\n');

// 0. 确保样例已导入（如果空的就导入）
const sensorCount = db.prepare('SELECT COUNT(*) as c FROM sensors').get().c;
if (sensorCount === 0) {
  console.log('  sensors 表为空，先导入样例...');
  const result = Sample.importSampleData();
  console.log(`  导入结果: success=${result.success}, sensors=${result.sensorCount}, readings=${result.readingCount}, anomalies=${result.anomalyCount}`);
}

// 1. Ground truth：每个子查询单独 COUNT
const gt = db.prepare(`
  SELECT
    s.id, s.name,
    (SELECT COUNT(*) FROM readings r WHERE r.sensor_id = s.id) as gt_readings,
    (SELECT COUNT(*) FROM anomalies a WHERE a.sensor_id = s.id) as gt_anomalies
  FROM sensors s
  ORDER BY s.name
`).all();

console.log('\n--- Ground truth（子查询单独 COUNT，绝对正确）---');
for (const r of gt) {
  console.log(`  ${r.id.padEnd(10)} readings=${r.gt_readings}  anomalies=${r.gt_anomalies}  product=${r.gt_readings * r.gt_anomalies}`);
}

// 2. 修复前的错误写法：LEFT JOIN 后直接 COUNT/SUM —— 笛卡尔积
const buggy = db.prepare(`
  SELECT s.id,
    COUNT(r.id) as buggy_reading_count,
    SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) as buggy_anomaly_count
  FROM sensors s
  LEFT JOIN readings r ON r.sensor_id = s.id
  LEFT JOIN anomalies a ON a.sensor_id = s.id
  GROUP BY s.id
  ORDER BY s.name
`).all();

console.log('\n--- ❌ 修复前（buggy）：LEFT JOIN 后直接 COUNT —— 笛卡尔积放大 ---');
let anyBug = false;
for (let i = 0; i < gt.length; i++) {
  const g = gt[i];
  const b = buggy[i];
  const ratioReadings = b.buggy_reading_count / (g.gt_readings || 1);
  const bugRepro = b.buggy_reading_count > g.gt_readings * 2 || b.buggy_anomaly_count > g.gt_anomalies * 10;
  if (bugRepro) anyBug = true;
  console.log(
    `  ${g.id.padEnd(10)} readings=${b.buggy_reading_count} (GT=${g.gt_readings}, 倍率=${ratioReadings.toFixed(1)}x)  ` +
    `anomalies=${b.buggy_anomaly_count} (GT=${g.gt_anomalies})  ${bugRepro ? '❌ BUG 复现' : '无放大'}`
  );
}

// 3. 修复后的写法：COUNT(DISTINCT)
const fixed = db.prepare(`
  SELECT s.id,
    COUNT(DISTINCT r.id) as fixed_reading_count,
    COUNT(DISTINCT a.id) as fixed_anomaly_count
  FROM sensors s
  LEFT JOIN readings r ON r.sensor_id = s.id
  LEFT JOIN anomalies a ON a.sensor_id = s.id
  GROUP BY s.id
  ORDER BY s.name
`).all();

console.log('\n--- ✅ 修复后（COUNT DISTINCT）：完全等于 GT ---');
let allFixed = true;
for (let i = 0; i < gt.length; i++) {
  const g = gt[i];
  const f = fixed[i];
  const okR = f.fixed_reading_count === g.gt_readings;
  const okA = f.fixed_anomaly_count === g.gt_anomalies;
  if (!okR || !okA) allFixed = false;
  console.log(
    `  ${g.id.padEnd(10)} readings=${f.fixed_reading_count} (GT=${g.gt_readings} ${okR ? '✅' : '❌'})  ` +
    `anomalies=${f.fixed_anomaly_count} (GT=${g.gt_anomalies} ${okA ? '✅' : '❌'})`
  );
}

// 4. 断言复现和修复有效性
console.log('\n======== 断言 =========\n');

// 4a. buggy 版本必须能复现（至少一台传感器读数被放大 2 倍以上）
const gtTotal = gt.reduce((s, r) => s + r.gt_readings, 0);
const buggyTotal = buggy.reduce((s, r) => s + r.buggy_reading_count, 0);
console.log(`  readings 总计 GT=${gtTotal}, buggy=${buggyTotal}, 倍率=${(buggyTotal / (gtTotal || 1)).toFixed(1)}x`);
assert.ok(
  buggyTotal > gtTotal * 2,
  `复现失败：buggy 版本读数总和 ${buggyTotal} 应该远大于 GT ${gtTotal}（至少 2 倍）`
);
console.log('  ✅ 复现断言通过：buggy SQL 确实把读数放大了');

// 4b. buggy 版本至少有一台达到百万级
const hasMillion = buggy.some(r => r.buggy_reading_count >= 1_000_000 || r.buggy_anomaly_count >= 1_000_000);
console.log(`  buggy 版本有百万级数字？ ${hasMillion ? '✅ 是' : '⚠️ 否（样例数据可能还不够大）'}`);

// 4c. 修复后完全等于 GT
assert.ok(allFixed, 'COUNT(DISTINCT) 修复后读数/异常必须完全等于 GT');
console.log('  ✅ 修复断言通过：COUNT(DISTINCT) 结果完全等于 GT');

// 4d. 再断言 findAllSensors() 的实际返回
const { findAllSensors } = await import(
  `file:///${path.join(projectRoot, 'api', 'repositories', 'SensorRepo.ts').replace(/\\/g, '/')}?t=${Date.now()}`
);
const repo = findAllSensors();
console.log(`\n--- findAllSensors() 实际返回 ---`);
for (const r of repo) {
  const g = gt.find(x => x.id === r.id);
  const ok = r.readingCount === g.gt_readings && r.anomalyCount <= g.gt_anomalies && r.pendingCount <= g.gt_anomalies;
  console.log(
    `  ${r.id.padEnd(10)} readingCount=${r.readingCount} anomalyCount=${r.anomalyCount} pendingCount=${r.pendingCount}  ${ok ? '✅' : '❌'}`
  );
  assert.ok(r.readingCount === g.gt_readings, `${r.id} readingCount 必须 = GT`);
  assert.ok(r.anomalyCount < 1_000_000, `${r.id} anomalyCount 不得百万级`);
  assert.ok(r.pendingCount < 1_000_000, `${r.id} pendingCount 不得百万级`);
}
console.log('  ✅ findAllSensors() 断言全部通过');

console.log('\n🚀 复现 + 修复验证全部通过\n');

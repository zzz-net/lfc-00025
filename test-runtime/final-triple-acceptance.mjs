#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// 业务模块（通过 tsx loader 转译）
const { findAllSensors } = await import(
  `file:///${path.join(projectRoot, 'api', 'repositories', 'SensorRepo.ts').replace(/\\/g, '/')}?t=${Date.now()}`
);
const DataDb = await import(
  `file:///${path.join(projectRoot, 'api', 'data', 'db.ts').replace(/\\/g, '/')}?t=${Date.now()}`
);

const db = DataDb.db;

console.log('\n======== 三方验收：SQLite ground truth ↔ findAllSensors() ↔ GET /api/sensors ========\n');

// ① SQLite ground truth
const rowsGt = db.prepare(`
  SELECT
    s.id, s.name,
    (SELECT COUNT(*) FROM readings r WHERE r.sensor_id = s.id) as gt_readings,
    (SELECT COUNT(*) FROM anomalies a WHERE a.sensor_id = s.id) as gt_anomalies_all
  FROM sensors s
  ORDER BY s.name
`).all();

// ② findAllSensors() 直接调用
const repoSensors = findAllSensors();

// ③ HTTP GET /api/sensors
const httpResp = await fetch('http://localhost:3001/api/sensors');
assert.equal(httpResp.status, 200, 'GET /api/sensors 必须返回 200');
const httpBody = await httpResp.json();
assert.ok(httpBody.success, 'GET /api/sensors 必须 success=true');
const httpSensors = httpBody.data;

assert.equal(httpSensors.length, rowsGt.length, `HTTP sensors 数量必须 = SQLite sensors 数量`);
assert.equal(repoSensors.length, rowsGt.length, `findAllSensors 数量必须 = SQLite sensors 数量`);

let sumGtReadings = 0;
let sumRepoReadings = 0;
let sumHttpReadings = 0;
let sumRepoAnomalies = 0;
let sumHttpAnomalies = 0;
let sumRepoPending = 0;
let sumHttpPending = 0;

for (const gt of rowsGt) {
  sumGtReadings += gt.gt_readings;
  const repo = repoSensors.find(s => s.id === gt.id);
  const http = httpSensors.find(s => s.id === gt.id);
  assert.ok(repo, `findAllSensors 必须有 ${gt.id}`);
  assert.ok(http, `HTTP /api/sensors 必须有 ${gt.id}`);

  sumRepoReadings += repo.readingCount;
  sumHttpReadings += http.readingCount;
  sumRepoAnomalies += repo.anomalyCount;
  sumHttpAnomalies += http.anomalyCount;
  sumRepoPending += repo.pendingCount;
  sumHttpPending += http.pendingCount;

  assert.equal(
    repo.readingCount, gt.gt_readings,
    `${gt.id} readingCount (repo=${repo.readingCount}) 必须 = SQLite gt_readings=${gt.gt_readings}`
  );
  assert.equal(
    http.readingCount, gt.gt_readings,
    `${gt.id} readingCount (http=${http.readingCount}) 必须 = SQLite gt_readings=${gt.gt_readings}`
  );

  assert.ok(
    repo.anomalyCount <= gt.gt_anomalies_all,
    `${gt.id} anomalyCount repo=${repo.anomalyCount} 必须 ≤ anomalies 总数 ${gt.gt_anomalies_all}`
  );
  assert.ok(
    http.anomalyCount <= gt.gt_anomalies_all,
    `${gt.id} anomalyCount http=${http.anomalyCount} 必须 ≤ anomalies 总数 ${gt.gt_anomalies_all}`
  );
  assert.ok(repo.anomalyCount < 1_000_000, `${gt.id} anomalyCount 不可能百万级`);
  assert.ok(http.anomalyCount < 1_000_000, `${gt.id} anomalyCount(http) 不可能百万级`);
  assert.ok(repo.pendingCount < 1_000_000, `${gt.id} pendingCount 不可能百万级`);
  assert.ok(http.pendingCount < 1_000_000, `${gt.id} pendingCount(http) 不可能百万级`);

  assert.equal(repo.anomalyCount, http.anomalyCount, `${gt.id} anomalyCount repo ↔ http 必须一致`);
  assert.equal(repo.pendingCount, http.pendingCount, `${gt.id} pendingCount repo ↔ http 必须一致`);

  console.log(
    `  ${gt.id.padEnd(10)} readings=${repo.readingCount} (GT=${gt.gt_readings} ✅)  ` +
    `anomalies=${repo.anomalyCount}/pending=${repo.pendingCount} (≤ ${gt.gt_anomalies_all} ✅)`
  );
}

console.log(`\n  总计 readings:  repo=${sumRepoReadings}  http=${sumHttpReadings}  SQLite GT=${sumGtReadings}`);
console.log(`  总计 anomalies: repo=${sumRepoAnomalies}  http=${sumHttpAnomalies}`);
console.log(`  总计 pending:   repo=${sumRepoPending}    http=${sumHttpPending}`);

assert.equal(sumRepoReadings, sumGtReadings, '汇总 readings 必须 = SQLite GT');
assert.equal(sumHttpReadings, sumGtReadings, 'HTTP 汇总 readings 必须 = SQLite GT');
assert.equal(sumHttpAnomalies, sumRepoAnomalies, 'HTTP 汇总 anomalies 必须 = repo');
assert.equal(sumHttpPending, sumRepoPending, 'HTTP 汇总 pending 必须 = repo');

console.log('\n✅ 三方验收全部通过：SQLite ↔ findAllSensors() ↔ GET /api/sensors 完全一致\n');

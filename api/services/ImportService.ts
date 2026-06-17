import type { ImportResponse, Sensor, Reading } from '../../shared/types.js';
import { findBatchByHash, insertBatch } from '../repositories/BatchRepo.js';
import { upsertSensor } from '../repositories/SensorRepo.js';
import { insertReadings } from '../repositories/ReadingRepo.js';
import { computeFileHash, generateId } from '../utils/fileHash.js';
import { parseCsvContent, parseJsonContent } from '../utils/csvParser.js';
import { getThresholdConfig } from '../repositories/ConfigRepo.js';
import { detectFromReadings } from './AnomalyDetector.js';
import { insertAnomaly } from '../repositories/AnomalyRepo.js';
import { generateSampleCsv } from './SampleDataGenerator.js';

export function importContent(
  fileName: string,
  content: string,
  isJson: boolean,
): ImportResponse {
  const fileHash = computeFileHash(content);
  const existing = findBatchByHash(fileHash);
  if (existing) {
    return {
      success: false,
      batchId: existing.id,
      totalRows: existing.rowCount,
      validRows: existing.rowCount - existing.errorCount,
      sensorIds: [],
      errors: existing.errors,
      duplicateBatch: true,
      existingBatchId: existing.id,
      message: `数据已存在，重复导入被拒绝（批次号：${existing.id.substring(0, 12)}）`,
    };
  }

  const batchId = generateId('b_');
  const parseResult = isJson
    ? parseJsonContent(content, batchId)
    : parseCsvContent(content, batchId);

  if (parseResult.validRows === 0) {
    return {
      success: false,
      batchId,
      totalRows: parseResult.totalRows,
      validRows: 0,
      sensorIds: [],
      errors: parseResult.errors,
      duplicateBatch: false,
      message: '无有效数据行，请检查文件内容',
    };
  }

  performImport(batchId, fileName, fileHash, parseResult.sensors, parseResult.readings, parseResult.errors);

  return {
    success: true,
    batchId,
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows,
    sensorIds: parseResult.sensors.map((s) => s.id),
    errors: parseResult.errors,
    duplicateBatch: false,
    message: `成功导入 ${parseResult.validRows} 行数据，涉及 ${parseResult.sensors.length} 台传感器`,
  };
}

function performImport(
  batchId: string,
  fileName: string,
  fileHash: string,
  sensors: Sensor[],
  readings: Reading[],
  errors: any[],
): void {
  const sensorIds = new Set(readings.map((r) => r.sensorId));
  const sensorList = sensors.filter((s) => sensorIds.has(s.id));

  const threshold = getThresholdConfig();
  const sensorReadingsMap = new Map<string, Reading[]>();
  for (const r of readings) {
    if (!sensorReadingsMap.has(r.sensorId)) sensorReadingsMap.set(r.sensorId, []);
    sensorReadingsMap.get(r.sensorId)!.push(r);
  }

  for (const s of sensorList) {
    upsertSensor(s);
  }
  insertBatch({
    id: batchId,
    fileName,
    fileHash,
    rowCount: readings.length + errors.length,
    sensorCount: sensorList.length,
    importedAt: new Date().toISOString(),
    errorCount: errors.length,
    errors,
  });
  insertReadings(readings);

  for (const [, rs] of sensorReadingsMap) {
    const detected = detectFromReadings(rs, threshold);
    for (const d of detected) {
      insertAnomaly({
        id: generateId('a_'),
        readingId: d.readingId,
        sensorId: d.sensorId,
        type: d.type,
        description: d.description,
        thresholdSnapshot: threshold,
      });
    }
  }
}

export function importSampleData(): ImportResponse {
  const content = generateSampleCsv();
  return importContent('sample_sensors_7days.csv', content, false);
}

export function verifyContent(
  fileName: string,
  content: string,
  isJson: boolean,
): Omit<ImportResponse, 'success' | 'batchId'> {
  const fileHash = computeFileHash(content);
  const existing = findBatchByHash(fileHash);
  const batchId = 'verify_' + generateId('');
  const parseResult = isJson
    ? parseJsonContent(content, batchId)
    : parseCsvContent(content, batchId);

  return {
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows,
    sensorIds: parseResult.sensors.map((s) => s.id),
    errors: parseResult.errors,
    duplicateBatch: !!existing,
    existingBatchId: existing?.id,
    message: existing
      ? `此文件内容已导入（批次号：${existing.id.substring(0, 12)}），将被拒绝重复导入`
      : parseResult.validRows > 0
        ? `校验通过，可导入 ${parseResult.validRows} 行`
        : `校验失败：${parseResult.errors.length} 个错误`,
  };
}

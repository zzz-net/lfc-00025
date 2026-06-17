import type { AnomalyType, Reading, ThresholdConfig } from '../../shared/types.js';
import { findAllSensors } from '../repositories/SensorRepo.js';
import { findReadingsBySensor } from '../repositories/ReadingRepo.js';
import {
  deleteAllUnprotectedAnomalies,
  insertAnomaly,
} from '../repositories/AnomalyRepo.js';
import { getThresholdConfig } from '../repositories/ConfigRepo.js';
import { generateId } from '../utils/fileHash.js';
import { db } from '../data/db.js';
import { insertAuditLog } from '../repositories/AuditLogRepo.js';

export interface DetectedAnomaly {
  readingId: string;
  sensorId: string;
  type: AnomalyType;
  description: string;
}

export function detectFromReadings(
  readings: Reading[],
  threshold: ThresholdConfig,
): DetectedAnomaly[] {
  const results: DetectedAnomaly[] = [];
  const sorted = [...readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];

    if (r.temperature > threshold.tempMax) {
      results.push({
        readingId: r.id,
        sensorId: r.sensorId,
        type: 'OVER_LIMIT_TEMP',
        description: `温度 ${r.temperature.toFixed(2)}℃ 超过上限 ${threshold.tempMax}℃`,
      });
    }
    if (r.temperature < threshold.tempMin) {
      results.push({
        readingId: r.id,
        sensorId: r.sensorId,
        type: 'UNDER_LIMIT_TEMP',
        description: `温度 ${r.temperature.toFixed(2)}℃ 低于下限 ${threshold.tempMin}℃`,
      });
    }
    if (r.humidity > threshold.humidMax) {
      results.push({
        readingId: r.id,
        sensorId: r.sensorId,
        type: 'OVER_LIMIT_HUMID',
        description: `湿度 ${r.humidity.toFixed(2)}% 超过上限 ${threshold.humidMax}%`,
      });
    }
    if (r.humidity < threshold.humidMin) {
      results.push({
        readingId: r.id,
        sensorId: r.sensorId,
        type: 'UNDER_LIMIT_HUMID',
        description: `湿度 ${r.humidity.toFixed(2)}% 低于下限 ${threshold.humidMin}%`,
      });
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const tempDiff = Math.abs(r.temperature - prev.temperature);
      const humidDiff = Math.abs(r.humidity - prev.humidity);
      if (tempDiff > threshold.tempDriftThreshold) {
        results.push({
          readingId: r.id,
          sensorId: r.sensorId,
          type: 'DRIFT_TEMP',
          description: `温度突变 ${tempDiff.toFixed(2)}℃，超过阈值 ${threshold.tempDriftThreshold}℃（前值 ${prev.temperature.toFixed(2)}℃）`,
        });
      }
      if (humidDiff > threshold.humidDriftThreshold) {
        results.push({
          readingId: r.id,
          sensorId: r.sensorId,
          type: 'DRIFT_HUMID',
          description: `湿度突变 ${humidDiff.toFixed(2)}%，超过阈值 ${threshold.humidDriftThreshold}%（前值 ${prev.humidity.toFixed(2)}%）`,
        });
      }

      const gapSec =
        (new Date(r.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
      if (gapSec > threshold.gapThresholdSeconds) {
        results.push({
          readingId: r.id,
          sensorId: r.sensorId,
          type: 'DATA_GAP',
          description: `数据断点 ${Math.round(gapSec)}秒，超过阈值 ${threshold.gapThresholdSeconds}秒`,
        });
      }
    }
  }

  return results;
}

export function runFullDetection(
  thresholdOverride?: ThresholdConfig,
  options?: { beforeThreshold?: ThresholdConfig; operator?: string },
): {
  totalAnalyzed: number;
  newAnomalies: number;
  protectedCount: number;
} {
  const threshold = thresholdOverride ?? getThresholdConfig();
  const sensors = findAllSensors();

  deleteAllUnprotectedAnomalies();

  let totalAnalyzed = 0;
  let newAnomalies = 0;

  for (const s of sensors) {
    const readings = findReadingsBySensor(s.id);
    totalAnalyzed += readings.length;
    const detected = detectFromReadings(readings, threshold);
    for (const d of detected) {
      insertAnomaly({
        id: generateId('a_'),
        readingId: d.readingId,
        sensorId: d.sensorId,
        type: d.type,
        description: d.description,
        thresholdSnapshot: threshold,
      });
      newAnomalies++;
    }
  }

  const protectedRow: any = db
    .prepare('SELECT COUNT(*) as c FROM anomalies WHERE has_manual_override = 1')
    .get();

  if (options?.beforeThreshold) {
    insertAuditLog({
      action: 'THRESHOLD_UPDATE',
      entityType: 'threshold',
      entityId: '1',
      operator: options.operator || 'system',
      before: options.beforeThreshold,
      after: threshold,
      detail: `阈值更新，重算完成：新增 ${newAnomalies} 条，保护人工结论 ${protectedRow?.c || 0} 条`,
    });
  }

  return {
    totalAnalyzed,
    newAnomalies,
    protectedCount: protectedRow?.c || 0,
  };
}

export interface ThresholdPreviewResult {
  affectedSensors: {
    sensorId: string;
    sensorName: string;
    currentCount: number;
    newCount: number;
    delta: number;
  }[];
  byType: {
    type: string;
    currentCount: number;
    newCount: number;
    delta: number;
  }[];
  summary: {
    currentTotal: number;
    newTotal: number;
    delta: number;
    addedCount: number;
    removedCount: number;
    protectedCount: number;
    totalReadings: number;
  };
}

export function previewDetection(
  newThreshold: ThresholdConfig,
): ThresholdPreviewResult {
  const _currentThreshold = getThresholdConfig();
  const sensors = findAllSensors();

  const currentUnprotected: any[] = db.prepare(`
    SELECT a.id, a.sensor_id, a.type, a.reading_id
    FROM anomalies a
    WHERE a.has_manual_override = 0
  `).all();

  const protectedRow: any = db
    .prepare('SELECT COUNT(*) as c FROM anomalies WHERE has_manual_override = 1')
    .get();

  const currentBySensor: Record<string, number> = {};
  const currentByType: Record<string, number> = {};
  const currentReadingIds = new Set<string>();

  for (const a of currentUnprotected) {
    currentBySensor[a.sensor_id] = (currentBySensor[a.sensor_id] || 0) + 1;
    currentByType[a.type] = (currentByType[a.type] || 0) + 1;
    currentReadingIds.add(a.reading_id);
  }

  const newBySensor: Record<string, number> = {};
  const newByType: Record<string, number> = {};
  const newReadingIds = new Set<string>();
  let totalReadings = 0;

  for (const s of sensors) {
    const readings = findReadingsBySensor(s.id);
    totalReadings += readings.length;
    const detected = detectFromReadings(readings, newThreshold);
    for (const d of detected) {
      newBySensor[d.sensorId] = (newBySensor[d.sensorId] || 0) + 1;
      newByType[d.type] = (newByType[d.type] || 0) + 1;
      newReadingIds.add(d.readingId);
    }
  }

  const allSensorIds = new Set([...Object.keys(currentBySensor), ...Object.keys(newBySensor)]);
  const allTypes = new Set([...Object.keys(currentByType), ...Object.keys(newByType)]);

  const affectedSensors: ThresholdPreviewResult['affectedSensors'] = [];
  for (const sid of allSensorIds) {
    const sensor = sensors.find((s) => s.id === sid);
    const cur = currentBySensor[sid] || 0;
    const nw = newBySensor[sid] || 0;
    if (cur !== nw) {
      affectedSensors.push({
        sensorId: sid,
        sensorName: sensor?.name || sid,
        currentCount: cur,
        newCount: nw,
        delta: nw - cur,
      });
    }
  }
  affectedSensors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const byType: ThresholdPreviewResult['byType'] = [];
  for (const t of allTypes) {
    const cur = currentByType[t] || 0;
    const nw = newByType[t] || 0;
    byType.push({
      type: t,
      currentCount: cur,
      newCount: nw,
      delta: nw - cur,
    });
  }
  byType.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const currentTotal = currentUnprotected.length;
  const newTotal = Array.from(newReadingIds).length;

  let addedCount = 0;
  for (const rid of newReadingIds) {
    if (!currentReadingIds.has(rid)) addedCount++;
  }
  let removedCount = 0;
  for (const rid of currentReadingIds) {
    if (!newReadingIds.has(rid)) removedCount++;
  }

  return {
    affectedSensors,
    byType,
    summary: {
      currentTotal,
      newTotal,
      delta: newTotal - currentTotal,
      addedCount,
      removedCount,
      protectedCount: protectedRow?.c || 0,
      totalReadings,
    },
  };
}

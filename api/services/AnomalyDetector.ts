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

export function runFullDetection(thresholdOverride?: ThresholdConfig): {
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

  return {
    totalAnalyzed,
    newAnomalies,
    protectedCount: protectedRow?.c || 0,
  };
}

import { db } from '../data/db.js';
import type { Anomaly, AnomalyType, AnnotationStatus, ThresholdConfig } from '../../shared/types.js';

export function deleteAnomaliesBySensor(sensorId: string): void {
  db.prepare('DELETE FROM anomalies WHERE sensor_id = ? AND has_manual_override = 0').run(sensorId);
}

export function deleteAllUnprotectedAnomalies(): void {
  db.prepare(`
    DELETE FROM annotations
    WHERE anomaly_id IN (SELECT id FROM anomalies WHERE has_manual_override = 0)
  `).run();
  db.prepare('DELETE FROM anomalies WHERE has_manual_override = 0').run();
}

export function insertAnomaly(anomaly: {
  id: string;
  readingId: string;
  sensorId: string;
  type: AnomalyType;
  description: string;
  thresholdSnapshot: ThresholdConfig;
}): void {
  const existing = db.prepare(
    'SELECT id FROM anomalies WHERE reading_id = ? AND type = ?',
  ).get(anomaly.readingId, anomaly.type) as any;
  if (existing) return;

  db.prepare(`
    INSERT INTO anomalies (id, reading_id, sensor_id, type, description, detected_at, threshold_snapshot, has_manual_override)
    VALUES (@id, @readingId, @sensorId, @type, @description, datetime('now'), @thresholdSnapshot, 0)
  `).run({
    id: anomaly.id,
    readingId: anomaly.readingId,
    sensorId: anomaly.sensorId,
    type: anomaly.type,
    description: anomaly.description,
    thresholdSnapshot: JSON.stringify(anomaly.thresholdSnapshot),
  });
}

export function markAnomalyOverridden(anomalyId: string): void {
  db.prepare('UPDATE anomalies SET has_manual_override = 1 WHERE id = ?').run(anomalyId);
}

export function clearAnomalyOverridden(anomalyId: string): void {
  db.prepare('UPDATE anomalies SET has_manual_override = 0 WHERE id = ?').run(anomalyId);
}

export function findAllAnomalies(
  sensorId?: string,
  statusFilter?: 'ALL' | AnnotationStatus,
  timeRange?: { start?: string; end?: string },
): Anomaly[] {
  let sql = `
    SELECT a.*, s.name as sensor_name,
      r.timestamp, r.temperature, r.humidity, r.batch_id
    FROM anomalies a
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
  `;
  const where: string[] = [];
  const params: any[] = [];

  if (sensorId) {
    where.push('a.sensor_id = ?');
    params.push(sensorId);
  }

  if (timeRange?.start) {
    where.push('r.timestamp >= ?');
    params.push(timeRange.start);
  }
  if (timeRange?.end) {
    where.push('r.timestamp <= ?');
    params.push(timeRange.end);
  }

  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ' ORDER BY r.timestamp DESC';

  const rows: any[] = db.prepare(sql).all(...params);

  let anomalies = rows.map((r) => rowToAnomaly(r));

  if (statusFilter && statusFilter !== 'ALL') {
    anomalies = anomalies.filter((a) => {
      const s = a.latestAnnotation?.status || 'DETECTED';
      const rolled = a.latestAnnotation?.rolledBackAt != null;
      if (rolled) return statusFilter === 'DETECTED';
      return s === statusFilter;
    });
  }

  return anomalies;
}

export function findAnomalyById(id: string): Anomaly | null {
  const row: any = db.prepare(`
    SELECT a.*, s.name as sensor_name,
      r.timestamp, r.temperature, r.humidity, r.batch_id
    FROM anomalies a
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    WHERE a.id = ?
  `).get(id);
  if (!row) return null;
  return rowToAnomaly(row);
}

function rowToAnomaly(row: any): Anomaly {
  let thresholdSnapshot: ThresholdConfig;
  try {
    thresholdSnapshot = JSON.parse(row.threshold_snapshot);
  } catch {
    thresholdSnapshot = {
      tempMin: 15, tempMax: 30, humidMin: 30, humidMax: 70,
      tempDriftThreshold: 2, humidDriftThreshold: 10, gapThresholdSeconds: 600,
    };
  }

  const latestAnn: any = db.prepare(`
    SELECT * FROM annotations
    WHERE anomaly_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(row.id);

  return {
    id: row.id,
    readingId: row.reading_id,
    sensorId: row.sensor_id,
    sensorName: row.sensor_name,
    type: row.type,
    description: row.description,
    detectedAt: row.detected_at,
    thresholdSnapshot,
    hasManualOverride: row.has_manual_override,
    reading: {
      id: row.reading_id,
      sensorId: row.sensor_id,
      timestamp: row.timestamp,
      temperature: row.temperature,
      humidity: row.humidity,
      batchId: row.batch_id,
    },
    latestAnnotation: latestAnn ? {
      id: latestAnn.id,
      anomalyId: latestAnn.anomaly_id,
      status: latestAnn.status,
      handler: latestAnn.handler,
      reason: latestAnn.reason,
      createdAt: latestAnn.created_at,
      rolledBackAt: latestAnn.rolled_back_at,
      rollbackReason: latestAnn.rollback_reason,
    } : undefined,
  };
}

export function findAnomaliesByReadingId(readingId: string): Anomaly[] {
  const rows: any[] = db.prepare(`
    SELECT a.*, s.name as sensor_name,
      r.timestamp, r.temperature, r.humidity, r.batch_id
    FROM anomalies a
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    WHERE a.reading_id = ?
    ORDER BY a.type
  `).all(readingId);
  return rows.map(rowToAnomaly);
}

export function findAllUnprotectedBySensor(sensorId: string): Anomaly[] {
  const rows: any[] = db.prepare(`
    SELECT a.*, s.name as sensor_name,
      r.timestamp, r.temperature, r.humidity, r.batch_id
    FROM anomalies a
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    WHERE a.sensor_id = ? AND a.has_manual_override = 0
    ORDER BY r.timestamp ASC
  `).all(sensorId);
  return rows.map(rowToAnomaly);
}

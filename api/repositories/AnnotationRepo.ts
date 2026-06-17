import { db } from '../data/db.js';
import type { Annotation, AnnotationStatus } from '../../shared/types.js';
import { clearAnomalyOverridden, markAnomalyOverridden } from './AnomalyRepo.js';

export function insertAnnotation(annotation: {
  id: string;
  anomalyId: string;
  status: AnnotationStatus;
  handler: string;
  reason: string;
}): Annotation {
  db.prepare(`
    INSERT INTO annotations (id, anomaly_id, status, handler, reason, created_at)
    VALUES (@id, @anomalyId, @status, @handler, @reason, datetime('now'))
  `).run({
    id: annotation.id,
    anomalyId: annotation.anomalyId,
    status: annotation.status,
    handler: annotation.handler,
    reason: annotation.reason,
  });
  markAnomalyOverridden(annotation.anomalyId);
  return findAnnotationById(annotation.id)!;
}

export function findAnnotationById(id: string): Annotation | null {
  const row: any = db.prepare(`
    SELECT ann.*, a.type as anomaly_type, s.name as sensor_name, r.timestamp
    FROM annotations ann
    JOIN anomalies a ON a.id = ann.anomaly_id
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    WHERE ann.id = ?
  `).get(id);
  if (!row) return null;
  return rowToAnnotation(row);
}

export function findLatestAnnotation(): Annotation | null {
  const row: any = db.prepare(`
    SELECT ann.*, a.type as anomaly_type, s.name as sensor_name, r.timestamp
    FROM annotations ann
    JOIN anomalies a ON a.id = ann.anomaly_id
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    WHERE ann.rolled_back_at IS NULL
    ORDER BY ann.created_at DESC
    LIMIT 1
  `).get();
  if (!row) return null;
  return rowToAnnotation(row);
}

export function rollbackLatestAnnotation(reason: string): Annotation | null {
  const latest = findLatestAnnotation();
  if (!latest) return null;
  db.prepare(`
    UPDATE annotations
    SET rolled_back_at = datetime('now'), rollback_reason = ?
    WHERE id = ?
  `).run(reason || '回滚操作', latest.id);

  const remaining = db.prepare(`
    SELECT COUNT(*) as c FROM annotations
    WHERE anomaly_id = ? AND rolled_back_at IS NULL
  `).get(latest.anomalyId) as any;
  if (remaining.c === 0) {
    clearAnomalyOverridden(latest.anomalyId);
  }

  return findAnnotationById(latest.id);
}

export function findAnnotationHistory(limit = 100): Annotation[] {
  const rows: any[] = db.prepare(`
    SELECT ann.*, a.type as anomaly_type, s.name as sensor_name, r.timestamp
    FROM annotations ann
    JOIN anomalies a ON a.id = ann.anomaly_id
    JOIN sensors s ON s.id = a.sensor_id
    JOIN readings r ON r.id = a.reading_id
    ORDER BY ann.created_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map(rowToAnnotation);
}

function rowToAnnotation(row: any): Annotation {
  return {
    id: row.id,
    anomalyId: row.anomaly_id,
    status: row.status,
    handler: row.handler,
    reason: row.reason,
    createdAt: row.created_at,
    rolledBackAt: row.rolled_back_at,
    rollbackReason: row.rollback_reason,
    anomalyType: row.anomaly_type,
    sensorName: row.sensor_name,
    timestamp: row.timestamp,
  };
}

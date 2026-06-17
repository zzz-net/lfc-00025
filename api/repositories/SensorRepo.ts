import { db } from '../data/db.js';
import type { Sensor } from '../../shared/types.js';

// 统计查询使用 COUNT(DISTINCT) 避免 readings × anomalies 笛卡尔积放大结果
export function findAllSensors(): Sensor[] {
  const rows = db.prepare(`
    SELECT s.*,
      COUNT(DISTINCT r.id) as reading_count,
      COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND (ann.status IS NULL OR ann.status = 'DETECTED' OR ann.rolled_back_at IS NOT NULL) THEN a.id END) as anomaly_count,
      COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND (ann.status = 'PENDING' OR ann.status IS NULL) THEN a.id END) as pending_count
    FROM sensors s
    LEFT JOIN readings r ON r.sensor_id = s.id
    LEFT JOIN anomalies a ON a.sensor_id = s.id
    LEFT JOIN (
      SELECT anomaly_id, status, MAX(created_at) as latest, rolled_back_at
      FROM annotations
      GROUP BY anomaly_id
    ) ann ON ann.anomaly_id = a.id
    GROUP BY s.id
    ORDER BY s.name
  `).all() as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    location: r.location || '',
    model: r.model || '',
    createdAt: r.created_at,
    readingCount: r.reading_count || 0,
    anomalyCount: r.anomaly_count || 0,
    pendingCount: r.pending_count || 0,
  }));
}

export function findSensorById(id: string): Sensor | null {
  const row: any = db.prepare('SELECT * FROM sensors WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    model: row.model || '',
    createdAt: row.created_at,
  };
}

export function upsertSensor(sensor: Sensor): void {
  db.prepare(`
    INSERT INTO sensors (id, name, location, model, created_at)
    VALUES (@id, @name, @location, @model, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      location = excluded.location,
      model = excluded.model
  `).run({
    id: sensor.id,
    name: sensor.name,
    location: sensor.location,
    model: sensor.model,
    createdAt: sensor.createdAt || new Date().toISOString(),
  });
}

export function deleteSensorAndData(id: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM annotations WHERE anomaly_id IN (SELECT id FROM anomalies WHERE sensor_id = ?)').run(id);
    db.prepare('DELETE FROM anomalies WHERE sensor_id = ?').run(id);
    db.prepare('DELETE FROM readings WHERE sensor_id = ?').run(id);
    db.prepare('DELETE FROM sensors WHERE id = ?').run(id);
  });
  tx();
}

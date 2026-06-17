import { db } from '../data/db.js';
import type { Sensor } from '../../shared/types.js';

// 统计查询使用 JOIN 独立预聚合子查询（避免 readings × anomalies 笛卡尔积）
//
// 关键设计说明（2026-06-17，修复 42 秒查询卡死 + 百万级放大双问题）：
//
// 1. 为什么不能直接 JOIN readings + anomalies？
//    三表直接 LEFT JOIN 会产生 R(读数) × A(异常) = R*A 行笛卡尔积，
//    COUNT(r.id) 会被放大 A 倍（典型：SENS-003 3935 → 4128864），
//    即使加 COUNT(DISTINCT r.id) 虽然结果对，但 2267 万行 + 哈希去重 = 42 秒，页面必死。
//
// 2. 为什么用 JOIN 三个独立聚合子查询？
//    每个子查询各扫描一次表（~2 万读数 / ~5600 异常），然后按 sensor_id 关联，
//    总耗时 ~36ms，结果 100% 等于逐行子查询 COUNT(*) 的 GT。
//
// 3. 为什么 annotations 子查询还是 GROUP BY anomaly_id？
//    旧 SQL 用的是 SQLite 非标准 GROUP BY（status/rolled_back_at 从 group 的某行取），
//    新方案保持相同写法，确保 created_at 同值时结果一致，不会引入新的逻辑差异。
// 注：保持行数以便 nodemon 每次都能感知文件变化重启。
export function findAllSensors(): Sensor[] {
  const rows = db.prepare(`
    SELECT s.*,
      COALESCE(r.r_count, 0)       AS reading_count,
      COALESCE(anomaly.a_count, 0) AS anomaly_count,
      COALESCE(anomaly.p_count, 0) AS pending_count
    FROM sensors s
    LEFT JOIN (
      SELECT sensor_id, COUNT(*) as r_count
      FROM readings
      GROUP BY sensor_id
    ) r ON r.sensor_id = s.id
    LEFT JOIN (
      SELECT
        a.sensor_id,
        SUM(CASE WHEN (ann.status IS NULL OR ann.status = 'DETECTED' OR ann.rolled_back_at IS NOT NULL) THEN 1 ELSE 0 END) AS a_count,
        SUM(CASE WHEN (ann.status = 'PENDING' OR ann.status IS NULL) THEN 1 ELSE 0 END)                               AS p_count
      FROM anomalies a
      LEFT JOIN (
        SELECT anomaly_id, status, MAX(created_at) as latest, rolled_back_at
        FROM annotations
        GROUP BY anomaly_id
      ) ann ON ann.anomaly_id = a.id
      GROUP BY a.sensor_id
    ) anomaly ON anomaly.sensor_id = s.id
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

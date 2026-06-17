import { db } from '../data/db.js';
import type { Reading } from '../../shared/types.js';

export function insertReading(reading: Reading): void {
  db.prepare(`
    INSERT INTO readings (id, sensor_id, timestamp, temperature, humidity, batch_id, raw_row)
    VALUES (@id, @sensorId, @timestamp, @temperature, @humidity, @batchId, @rawRow)
  `).run({
    id: reading.id,
    sensorId: reading.sensorId,
    timestamp: reading.timestamp,
    temperature: reading.temperature,
    humidity: reading.humidity,
    batchId: reading.batchId,
    rawRow: reading.rawRow ?? null,
  });
}

export function insertReadings(readings: Reading[]): void {
  if (readings.length === 0) return;
  const stmt = db.prepare(`
    INSERT INTO readings (id, sensor_id, timestamp, temperature, humidity, batch_id, raw_row)
    VALUES (@id, @sensorId, @timestamp, @temperature, @humidity, @batchId, @rawRow)
  `);
  const tx = db.transaction((list: Reading[]) => {
    for (const r of list) {
      stmt.run({
        id: r.id,
        sensorId: r.sensorId,
        timestamp: r.timestamp,
        temperature: r.temperature,
        humidity: r.humidity,
        batchId: r.batchId,
        rawRow: r.rawRow ?? null,
      });
    }
  });
  tx(readings);
}

export function findReadingsBySensor(
  sensorId: string,
  startTime?: string,
  endTime?: string,
): Reading[] {
  let sql = 'SELECT * FROM readings WHERE sensor_id = ?';
  const params: any[] = [sensorId];

  if (startTime) {
    sql += ' AND timestamp >= ?';
    params.push(startTime);
  }
  if (endTime) {
    sql += ' AND timestamp <= ?';
    params.push(endTime);
  }
  sql += ' ORDER BY timestamp ASC';

  const rows: any[] = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    id: r.id,
    sensorId: r.sensor_id,
    timestamp: r.timestamp,
    temperature: r.temperature,
    humidity: r.humidity,
    batchId: r.batch_id,
    rawRow: r.raw_row,
  }));
}

export function countReadings(): number {
  const row: any = db.prepare('SELECT COUNT(*) as c FROM readings').get();
  return row?.c || 0;
}

export function countReadingsBySensor(sensorId: string): number {
  const row: any = db.prepare('SELECT COUNT(*) as c FROM readings WHERE sensor_id = ?').get(sensorId);
  return row?.c || 0;
}

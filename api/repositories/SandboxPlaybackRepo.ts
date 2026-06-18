import { db } from '../data/db.js';
import { generateId } from '../utils/fileHash.js';
import type {
  SandboxPlayback, SandboxPlaybackStatus, SandboxPlaybackSourceType,
  SandboxAnomaly, AnomalyType,
} from '../../shared/types.js';

function rowToPlayback(row: any): SandboxPlayback {
  let sensorIds: string[] | undefined;
  let sourceMeta: any;
  let result: any;
  try { if (row.sensor_ids_json) sensorIds = JSON.parse(row.sensor_ids_json); } catch { /* ignore */ }
  try { if (row.source_meta_json) sourceMeta = JSON.parse(row.source_meta_json); } catch { /* ignore */ }
  try { if (row.result_json) result = JSON.parse(row.result_json); } catch { /* ignore */ }

  return {
    id: row.id,
    sandboxRuleId: row.sandbox_rule_id,
    name: row.name,
    sourceType: row.source_type as SandboxPlaybackSourceType,
    sourceMeta,
    status: row.status as SandboxPlaybackStatus,
    sensorIds,
    timeStart: row.time_start ?? undefined,
    timeEnd: row.time_end ?? undefined,
    totalReadings: row.total_readings,
    anomalyCount: row.anomaly_count,
    result,
    errorMessage: row.error_message ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToSandboxAnomaly(row: any): SandboxAnomaly {
  return {
    id: row.id,
    playbackId: row.playback_id,
    sandboxRuleId: row.sandbox_rule_id,
    sensorId: row.sensor_id,
    readingId: row.reading_id ?? undefined,
    type: row.type as AnomalyType,
    description: row.description,
    readingTimestamp: row.reading_timestamp,
    temperature: row.temperature ?? undefined,
    humidity: row.humidity ?? undefined,
    isNewComparedToLive: row.is_new_compared_to_live,
    isMissingComparedToLive: row.is_missing_compared_to_live,
    createdAt: row.created_at,
  };
}

export function findPlaybacksByRule(ruleId: string, limit = 20): SandboxPlayback[] {
  const rows: any[] = db.prepare(`
    SELECT * FROM sandbox_playbacks
    WHERE sandbox_rule_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(ruleId, limit);
  return rows.map(rowToPlayback);
}

export function findPlaybackById(id: string): SandboxPlayback | null {
  const row: any = db.prepare('SELECT * FROM sandbox_playbacks WHERE id = ?').get(id);
  if (!row) return null;
  return rowToPlayback(row);
}

export function createPlayback(data: {
  sandboxRuleId: string;
  name: string;
  sourceType: SandboxPlaybackSourceType;
  sourceMeta?: any;
  sensorIds?: string[];
  timeStart?: string;
  timeEnd?: string;
  createdBy?: string;
}): SandboxPlayback {
  const id = generateId('pb_');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sandbox_playbacks (
      id, sandbox_rule_id, name, source_type, source_meta_json,
      status, sensor_ids_json, time_start, time_end,
      total_readings, anomaly_count, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 0, 0, ?, ?)
  `).run(
    id,
    data.sandboxRuleId,
    data.name,
    data.sourceType,
    data.sourceMeta ? JSON.stringify(data.sourceMeta) : null,
    data.sensorIds ? JSON.stringify(data.sensorIds) : null,
    data.timeStart ?? null,
    data.timeEnd ?? null,
    data.createdBy ?? 'system',
    now,
  );
  return findPlaybackById(id)!;
}

export function updatePlaybackStatus(
  id: string,
  status: SandboxPlaybackStatus,
  extra?: {
    totalReadings?: number;
    anomalyCount?: number;
    result?: any;
    errorMessage?: string;
    completedAt?: string | null;
  },
): SandboxPlayback | null {
  const fields: string[] = ['status = ?'];
  const params: any[] = [status];

  if (extra?.totalReadings !== undefined) {
    fields.push('total_readings = ?');
    params.push(extra.totalReadings);
  }
  if (extra?.anomalyCount !== undefined) {
    fields.push('anomaly_count = ?');
    params.push(extra.anomalyCount);
  }
  if (extra?.result !== undefined) {
    fields.push('result_json = ?');
    params.push(JSON.stringify(extra.result));
  }
  if (extra?.errorMessage !== undefined) {
    fields.push('error_message = ?');
    params.push(extra.errorMessage);
  }
  if (extra?.completedAt !== undefined) {
    fields.push('completed_at = ?');
    params.push(extra.completedAt);
  }

  params.push(id);
  db.prepare(`UPDATE sandbox_playbacks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return findPlaybackById(id);
}

export function deletePlayback(id: string): boolean {
  const result = db.prepare('DELETE FROM sandbox_playbacks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function insertSandboxAnomalies(
  playbackId: string,
  ruleId: string,
  anomalies: Array<{
    sensorId: string;
    readingId?: string;
    type: AnomalyType;
    description: string;
    readingTimestamp: string;
    temperature?: number;
    humidity?: number;
    isNewComparedToLive?: number;
    isMissingComparedToLive?: number;
  }>,
): number {
  const stmt = db.prepare(`
    INSERT INTO sandbox_anomalies (
      id, playback_id, sandbox_rule_id, sensor_id, reading_id,
      type, description, reading_timestamp, temperature, humidity,
      is_new_compared_to_live, is_missing_compared_to_live
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  const tx = db.transaction((items: typeof anomalies) => {
    for (const a of items) {
      const id = generateId('sa_');
      stmt.run(
        id, playbackId, ruleId, a.sensorId, a.readingId ?? null,
        a.type, a.description, a.readingTimestamp,
        a.temperature ?? null, a.humidity ?? null,
        a.isNewComparedToLive ?? 0, a.isMissingComparedToLive ?? 0,
      );
      count++;
    }
  });
  tx(anomalies);
  return count;
}

export function findSandboxAnomaliesByPlayback(
  playbackId: string,
  options?: { sensorId?: string; type?: string; onlyNew?: boolean; onlyMissing?: boolean; limit?: number },
): SandboxAnomaly[] {
  let sql = 'SELECT * FROM sandbox_anomalies WHERE playback_id = ?';
  const params: any[] = [playbackId];

  if (options?.sensorId) { sql += ' AND sensor_id = ?'; params.push(options.sensorId); }
  if (options?.type) { sql += ' AND type = ?'; params.push(options.type); }
  if (options?.onlyNew) { sql += ' AND is_new_compared_to_live = 1'; }
  if (options?.onlyMissing) { sql += ' AND is_missing_compared_to_live = 1'; }

  sql += ' ORDER BY reading_timestamp ASC';

  if (options?.limit) { sql += ' LIMIT ?'; params.push(options.limit); }

  const rows: any[] = db.prepare(sql).all(...params);
  return rows.map(rowToSandboxAnomaly);
}

export function countSandboxAnomaliesByPlayback(playbackId: string): {
  total: number; newCount: number; missingCount: number; byType: Record<string, number>; bySensor: Record<string, number>;
} {
  const totalRow: any = db.prepare('SELECT COUNT(*) as c FROM sandbox_anomalies WHERE playback_id = ?').get(playbackId);
  const newRow: any = db.prepare('SELECT COUNT(*) as c FROM sandbox_anomalies WHERE playback_id = ? AND is_new_compared_to_live = 1').get(playbackId);
  const missingRow: any = db.prepare('SELECT COUNT(*) as c FROM sandbox_anomalies WHERE playback_id = ? AND is_missing_compared_to_live = 1').get(playbackId);

  const byTypeRows: any[] = db.prepare('SELECT type, COUNT(*) as c FROM sandbox_anomalies WHERE playback_id = ? GROUP BY type').all(playbackId);
  const bySensorRows: any[] = db.prepare('SELECT sensor_id, COUNT(*) as c FROM sandbox_anomalies WHERE playback_id = ? GROUP BY sensor_id').all(playbackId);

  const byType: Record<string, number> = {};
  const bySensor: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.type] = r.c;
  for (const r of bySensorRows) bySensor[r.sensor_id] = r.c;

  return {
    total: totalRow?.c || 0,
    newCount: newRow?.c || 0,
    missingCount: missingRow?.c || 0,
    byType,
    bySensor,
  };
}

export function getSandboxState(): {
  filter: any;
  view: any;
  selectedSandboxId: string | null;
  selectedPlaybackId: string | null;
} {
  const row: any = db.prepare('SELECT * FROM sandbox_state WHERE id = 1').get();
  let filter = {};
  let view = {};
  try { filter = JSON.parse(row.filter_json); } catch { /* ignore */ }
  try { view = JSON.parse(row.view_json); } catch { /* ignore */ }
  return {
    filter,
    view,
    selectedSandboxId: row.selected_sandbox_id,
    selectedPlaybackId: row.selected_playback_id,
  };
}

export function saveSandboxState(data: {
  filter?: any;
  view?: any;
  selectedSandboxId?: string | null;
  selectedPlaybackId?: string | null;
}): void {
  const current = getSandboxState();
  const filter = data.filter ?? current.filter;
  const view = data.view ?? current.view;
  const selectedSandboxId = data.selectedSandboxId !== undefined ? data.selectedSandboxId : current.selectedSandboxId;
  const selectedPlaybackId = data.selectedPlaybackId !== undefined ? data.selectedPlaybackId : current.selectedPlaybackId;

  db.prepare(`
    UPDATE sandbox_state SET
      filter_json = ?,
      view_json = ?,
      selected_sandbox_id = ?,
      selected_playback_id = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    JSON.stringify(filter),
    JSON.stringify(view),
    selectedSandboxId,
    selectedPlaybackId,
  );
}

import { db } from '../data/db.js';
import type { ThresholdConfig, AppState } from '../../shared/types.js';

export function getThresholdConfig(): ThresholdConfig {
  const row: any = db.prepare('SELECT * FROM threshold_config WHERE id = 1').get();
  return {
    tempMin: row.temp_min,
    tempMax: row.temp_max,
    humidMin: row.humid_min,
    humidMax: row.humid_max,
    tempDriftThreshold: row.temp_drift,
    humidDriftThreshold: row.humid_drift,
    gapThresholdSeconds: row.gap_seconds,
  };
}

export function updateThresholdConfig(config: ThresholdConfig): ThresholdConfig {
  db.prepare(`
    UPDATE threshold_config SET
      temp_min = ?, temp_max = ?,
      humid_min = ?, humid_max = ?,
      temp_drift = ?, humid_drift = ?,
      gap_seconds = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    config.tempMin, config.tempMax,
    config.humidMin, config.humidMax,
    config.tempDriftThreshold, config.humidDriftThreshold,
    config.gapThresholdSeconds,
  );
  return getThresholdConfig();
}

export function getAppState(): AppState {
  const row: any = db.prepare('SELECT * FROM app_state WHERE id = 1').get();
  let filter = {};
  let view = {};
  try { filter = JSON.parse(row.filter_json); } catch { /* ignore */ }
  try { view = JSON.parse(row.view_json); } catch { /* ignore */ }
  const f: any = filter;
  const v: any = view;
  return {
    selectedSensorId: f.selectedSensorId ?? null,
    statusFilter: f.statusFilter ?? 'ALL',
    timeRange: f.timeRange ?? 'ALL',
    customStart: f.customStart,
    customEnd: f.customEnd,
    workOrderFilter: f.workOrderFilter,
    workOrderView: v.workOrderView,
    view,
  };
}

export function saveAppState(state: AppState): AppState {
  const current = getAppState();
  const filter = {
    selectedSensorId: state.selectedSensorId ?? current.selectedSensorId,
    statusFilter: state.statusFilter ?? current.statusFilter,
    timeRange: state.timeRange ?? current.timeRange,
    customStart: state.customStart ?? current.customStart,
    customEnd: state.customEnd ?? current.customEnd,
    workOrderFilter: state.workOrderFilter ?? current.workOrderFilter,
  };
  const view = {
    ...(current.view || {}),
    ...(state.view || {}),
    workOrderView: state.workOrderView ?? (current as any).workOrderView,
  };
  db.prepare(`
    UPDATE app_state SET
      filter_json = ?,
      view_json = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(JSON.stringify(filter), JSON.stringify(view));
  return getAppState();
}

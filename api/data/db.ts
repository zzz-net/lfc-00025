import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.QC_DATA_DIR
  ? path.resolve(process.env.QC_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = process.env.QC_DB_PATH
  ? path.resolve(process.env.QC_DB_PATH)
  : path.join(DATA_DIR, 'qc_sensors.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DDL = `
CREATE TABLE IF NOT EXISTS sensors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_hash TEXT NOT NULL UNIQUE,
    row_count INTEGER NOT NULL DEFAULT 0,
    sensor_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    error_count INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT
);

CREATE TABLE IF NOT EXISTS readings (
    id TEXT PRIMARY KEY,
    sensor_id TEXT NOT NULL REFERENCES sensors(id),
    timestamp TEXT NOT NULL,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    batch_id TEXT NOT NULL REFERENCES import_batches(id),
    raw_row INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_sensor_time_unique ON readings(sensor_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_readings_batch ON readings(batch_id);

CREATE TABLE IF NOT EXISTS anomalies (
    id TEXT PRIMARY KEY,
    reading_id TEXT NOT NULL REFERENCES readings(id),
    sensor_id TEXT NOT NULL REFERENCES sensors(id),
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    threshold_snapshot TEXT NOT NULL,
    has_manual_override INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_anomalies_sensor ON anomalies(sensor_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_reading ON anomalies(reading_id);

CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    anomaly_id TEXT NOT NULL REFERENCES anomalies(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    handler TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    rolled_back_at TEXT,
    rollback_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_annotations_anomaly ON annotations(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_annotations_created ON annotations(created_at);

CREATE TABLE IF NOT EXISTS threshold_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    temp_min REAL NOT NULL DEFAULT 15,
    temp_max REAL NOT NULL DEFAULT 30,
    humid_min REAL NOT NULL DEFAULT 30,
    humid_max REAL NOT NULL DEFAULT 70,
    temp_drift REAL NOT NULL DEFAULT 2,
    humid_drift REAL NOT NULL DEFAULT 10,
    gap_seconds INTEGER NOT NULL DEFAULT 600,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    filter_json TEXT NOT NULL DEFAULT '{}',
    view_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    operator TEXT NOT NULL DEFAULT 'system',
    before_json TEXT,
    after_json TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
`;

db.exec(DDL);

const initThreshold = db.prepare(`
  INSERT OR IGNORE INTO threshold_config (id, temp_min, temp_max, humid_min, humid_max, temp_drift, humid_drift, gap_seconds)
  VALUES (1, 15, 30, 30, 70, 2, 10, 600)
`);
initThreshold.run();

const initState = db.prepare(`
  INSERT OR IGNORE INTO app_state (id, filter_json, view_json)
  VALUES (1, '{"selectedSensorId":null,"statusFilter":"ALL","timeRange":"ALL"}', '{}')
`);
initState.run();

export default db;

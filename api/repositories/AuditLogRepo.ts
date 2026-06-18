import { db } from '../data/db.js';
import { generateId } from '../utils/fileHash.js';

export type AuditAction =
  | 'ANNOTATE_CREATE'
  | 'ANNOTATE_ROLLBACK'
  | 'THRESHOLD_UPDATE'
  | 'IMPORT_BATCH'
  | 'ANOMALY_DETECT'
  | 'STATE_SAVE'
  | 'REPORT_EXPORT'
  | 'WORK_ORDER_CREATE'
  | 'WORK_ORDER_REASSIGN'
  | 'WORK_ORDER_CLOSE'
  | 'WORK_ORDER_REOPEN'
  | 'WORK_ORDER_UPDATE'
  | 'SANDBOX_RULE_CREATE'
  | 'SANDBOX_RULE_UPDATE'
  | 'SANDBOX_RULE_DELETE'
  | 'SANDBOX_RULE_COPY'
  | 'SANDBOX_RULE_PUBLISH'
  | 'SANDBOX_PLAYBACK_CREATE'
  | 'SANDBOX_PLAYBACK_COMPLETE'
  | 'SANDBOX_PLAYBACK_DELETE'
  | 'SANDBOX_EXPORT_CSV'
  | 'SANDBOX_STATE_SAVE';

export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  operator: string;
  beforeJson?: any;
  afterJson?: any;
  detail?: string;
  createdAt: string;
}

export function insertAuditLog(log: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  operator?: string;
  before?: any;
  after?: any;
  detail?: string;
}): AuditLog {
  const id = generateId('log_');
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, action, entity_type, entity_id, operator, before_json, after_json, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    log.action,
    log.entityType,
    log.entityId ?? null,
    log.operator ?? 'system',
    log.before != null ? JSON.stringify(log.before) : null,
    log.after != null ? JSON.stringify(log.after) : null,
    log.detail ?? null,
  );
  return findAuditLogById(id)!;
}

export function findAuditLogById(id: string): AuditLog | null {
  const row: any = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  if (!row) return null;
  return rowToAuditLog(row);
}

export function findAuditLogsByEntity(entityType: string, entityId?: string, limit = 100): AuditLog[] {
  let sql = 'SELECT * FROM audit_logs WHERE entity_type = ?';
  const params: any[] = [entityType];
  if (entityId) {
    sql += ' AND entity_id = ?';
    params.push(entityId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows: any[] = db.prepare(sql).all(...params);
  return rows.map(rowToAuditLog);
}

export function findRecentAuditLogs(limit = 200): AuditLog[] {
  const rows: any[] = db.prepare(
    'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
  ).all(limit);
  return rows.map(rowToAuditLog);
}

function rowToAuditLog(row: any): AuditLog {
  let beforeJson: any = undefined;
  let afterJson: any = undefined;
  try {
    if (row.before_json) beforeJson = JSON.parse(row.before_json);
  } catch { /* ignore */ }
  try {
    if (row.after_json) afterJson = JSON.parse(row.after_json);
  } catch { /* ignore */ }
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    operator: row.operator,
    beforeJson,
    afterJson,
    before: beforeJson,
    after: afterJson,
    detail: row.detail ?? undefined,
    createdAt: row.created_at,
  } as AuditLog & { before?: any; after?: any };
}

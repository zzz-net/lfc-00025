import { db } from '../data/db.js';
import { generateId } from '../utils/fileHash.js';
import { insertRuleHistory } from './SandboxRuleHistoryRepo.js';
import type { SandboxRule, SandboxRuleStatus, ThresholdConfig } from '../../shared/types.js';

function rowToSandboxRule(row: any): SandboxRule {
  let threshold: ThresholdConfig;
  try {
    threshold = JSON.parse(row.threshold_json);
  } catch {
    threshold = {
      tempMin: 15, tempMax: 30, humidMin: 30, humidMax: 70,
      tempDriftThreshold: 2, humidDriftThreshold: 10, gapThresholdSeconds: 600,
    };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as SandboxRuleStatus,
    threshold,
    sourceRuleId: row.source_rule_id ?? undefined,
    createdBy: row.created_by,
    publishedAt: row.published_at ?? undefined,
    publishedBy: row.published_by ?? undefined,
    baseVersionAt: row.base_version_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findAllSandboxRules(status?: SandboxRuleStatus): SandboxRule[] {
  let sql = 'SELECT * FROM sandbox_rules';
  const params: any[] = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY updated_at DESC';
  const rows: any[] = db.prepare(sql).all(...params);
  return rows.map(rowToSandboxRule);
}

export function findSandboxRuleById(id: string): SandboxRule | null {
  const row: any = db.prepare('SELECT * FROM sandbox_rules WHERE id = ?').get(id);
  if (!row) return null;
  return rowToSandboxRule(row);
}

export function createSandboxRule(data: {
  name: string;
  description?: string;
  threshold: ThresholdConfig;
  sourceRuleId?: string;
  createdBy?: string;
  baseVersionAt?: string;
}): SandboxRule {
  const id = generateId('sb_');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sandbox_rules (
      id, name, description, status, threshold_json,
      source_rule_id, created_by, base_version_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description ?? null,
    JSON.stringify(data.threshold),
    data.sourceRuleId ?? null,
    data.createdBy ?? 'system',
    data.baseVersionAt ?? null,
    now,
    now,
  );
  return findSandboxRuleById(id)!;
}

export function updateSandboxRule(
  id: string,
  data: {
    name?: string;
    description?: string;
    threshold?: ThresholdConfig;
    status?: SandboxRuleStatus;
    publishedAt?: string | null;
    publishedBy?: string | null;
    changedBy?: string;
    skipHistory?: boolean;
  },
): SandboxRule | null {
  const current = findSandboxRuleById(id);
  if (!current) return null;

  if (!data.skipHistory && (data.name !== undefined || data.description !== undefined || data.threshold !== undefined)) {
    const hasChange =
      (data.name !== undefined && data.name !== current.name) ||
      (data.description !== undefined && data.description !== (current.description ?? null)) ||
      (data.threshold !== undefined && JSON.stringify(data.threshold) !== JSON.stringify(current.threshold));
    if (hasChange) {
      try {
        insertRuleHistory({
          sandboxRuleId: id,
          name: current.name,
          description: current.description,
          threshold: current.threshold,
          changedBy: data.changedBy || 'system',
          changeReason: '更新规则前快照',
        });
      } catch { /* ignore history errors */ }
    }
  }

  const fields: string[] = [];
  const params: any[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); params.push(data.description ?? null); }
  if (data.threshold !== undefined) { fields.push('threshold_json = ?'); params.push(JSON.stringify(data.threshold)); }
  if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
  if (data.publishedAt !== undefined) { fields.push('published_at = ?'); params.push(data.publishedAt); }
  if (data.publishedBy !== undefined) { fields.push('published_by = ?'); params.push(data.publishedBy); }

  fields.push('updated_at = datetime(\'now\')');
  params.push(id);

  db.prepare(`UPDATE sandbox_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return findSandboxRuleById(id);
}

export function deleteSandboxRule(id: string): boolean {
  const result = db.prepare('DELETE FROM sandbox_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

export function copySandboxRule(sourceId: string, newName: string, createdBy?: string): SandboxRule | null {
  const source = findSandboxRuleById(sourceId);
  if (!source) return null;
  return createSandboxRule({
    name: newName,
    description: source.description ? `${source.description}（副本）` : undefined,
    threshold: source.threshold,
    sourceRuleId: sourceId,
    createdBy: createdBy ?? source.createdBy,
    baseVersionAt: source.updatedAt,
  });
}

export function publishSandboxRule(id: string, publishedBy?: string): SandboxRule | null {
  const now = new Date().toISOString();
  return updateSandboxRule(id, {
    status: 'PUBLISHED',
    publishedAt: now,
    publishedBy: publishedBy ?? 'system',
  });
}

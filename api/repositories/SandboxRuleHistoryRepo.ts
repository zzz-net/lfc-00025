import { db } from '../data/db.js';
import { generateId } from '../utils/fileHash.js';
import type { SandboxRuleHistory, ThresholdConfig } from '../../shared/types.js';

function rowToHistory(row: any): SandboxRuleHistory {
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
    sandboxRuleId: row.sandbox_rule_id,
    name: row.name,
    description: row.description ?? undefined,
    threshold,
    changedBy: row.changed_by,
    changeReason: row.change_reason ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertRuleHistory(data: {
  sandboxRuleId: string;
  name: string;
  description?: string;
  threshold: ThresholdConfig;
  changedBy: string;
  changeReason?: string;
}): SandboxRuleHistory {
  const id = generateId('h_');
  db.prepare(`
    INSERT INTO sandbox_rule_history (
      id, sandbox_rule_id, name, description, threshold_json,
      changed_by, change_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.sandboxRuleId,
    data.name,
    data.description ?? null,
    JSON.stringify(data.threshold),
    data.changedBy,
    data.changeReason ?? null,
  );
  return findHistoryById(id)!;
}

export function findHistoryById(id: string): SandboxRuleHistory | null {
  const row: any = db.prepare('SELECT * FROM sandbox_rule_history WHERE id = ?').get(id);
  if (!row) return null;
  return rowToHistory(row);
}

export function findLatestHistory(ruleId: string): SandboxRuleHistory | null {
  const row: any = db.prepare(`
    SELECT * FROM sandbox_rule_history
    WHERE sandbox_rule_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(ruleId);
  if (!row) return null;
  return rowToHistory(row);
}

export function findHistoryByRule(ruleId: string, limit = 20): SandboxRuleHistory[] {
  const rows: any[] = db.prepare(`
    SELECT * FROM sandbox_rule_history
    WHERE sandbox_rule_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(ruleId, limit);
  return rows.map(rowToHistory);
}

export function deleteHistoryById(id: string): boolean {
  const result = db.prepare('DELETE FROM sandbox_rule_history WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteHistoryOlderThan(ruleId: string, keepCount = 10): number {
  const rows: any[] = db.prepare(`
    SELECT id FROM sandbox_rule_history
    WHERE sandbox_rule_id = ?
    ORDER BY id DESC
    LIMIT -1 OFFSET ?
  `).all(ruleId, keepCount);
  let deleted = 0;
  for (const r of rows) {
    if (deleteHistoryById(r.id)) deleted++;
  }
  return deleted;
}

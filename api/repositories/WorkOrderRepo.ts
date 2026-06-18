import { db } from '../data/db.js';
import type {
  WorkOrder, WorkOrderHistory, WorkOrderStatus, WorkOrderPriority,
  WorkOrderAction, WorkOrderFilter,
} from '../../shared/types.js';
import { findAnomalyById } from './AnomalyRepo.js';
import { generateId } from '../utils/fileHash.js';
import { insertAuditLog } from './AuditLogRepo.js';

interface CreateWorkOrderInput {
  anomalyId: string;
  title: string;
  priority: WorkOrderPriority;
  assignee: string;
  creator: string;
  deadline?: string;
  remark?: string;
}

function findActiveWorkOrderByAnomalyId(anomalyId: string): WorkOrder | null {
  const row: any = db.prepare(`
    SELECT wo.* FROM work_orders wo
    WHERE wo.anomaly_id = ? AND wo.status IN ('PENDING', 'IN_PROGRESS')
    LIMIT 1
  `).get(anomalyId);
  if (!row) return null;
  return rowToWorkOrder(row);
}

export function createWorkOrder(input: CreateWorkOrderInput): WorkOrder {
  const active = findActiveWorkOrderByAnomalyId(input.anomalyId);
  if (active) {
    const err: any = new Error(`该异常已存在未关闭的工单：${active.id}`);
    err.code = 'CONFLICT';
    err.conflictWorkOrder = active;
    throw err;
  }
  const anomaly = findAnomalyById(input.anomalyId);
  if (!anomaly) {
    throw new Error('异常记录不存在');
  }
  const id = generateId('wo_');
  db.prepare(`
    INSERT INTO work_orders (
      id, anomaly_id, title, priority, status, assignee, creator,
      deadline, remark, can_reopen, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `).run(
    id, input.anomalyId, input.title, input.priority,
    input.assignee, input.creator, input.deadline ?? null, input.remark ?? null,
  );
  const wo = findWorkOrderById(id)!;
  insertWorkOrderHistory(id, 'CREATE', input.creator, null, {
    title: input.title,
    priority: input.priority,
    assignee: input.assignee,
    deadline: input.deadline,
    remark: input.remark,
  }, `创建工单：${input.title}`);
  insertAuditLog({
    action: 'WORK_ORDER_CREATE',
    entityType: 'work_order',
    entityId: id,
    operator: input.creator,
    before: null,
    after: wo,
    detail: `创建工单 ${id.substring(0, 12)} 关联异常 ${input.anomalyId.substring(0, 12)}`,
  });
  return wo;
}

export function findWorkOrderById(id: string): WorkOrder | null {
  const row: any = db.prepare(`
    SELECT wo.*, an.sensor_id as _sensor_id
    FROM work_orders wo
    JOIN anomalies an ON an.id = wo.anomaly_id
    WHERE wo.id = ?
  `).get(id);
  if (!row) return null;
  return rowToWorkOrder(row);
}

export function findAllWorkOrders(filter?: WorkOrderFilter): WorkOrder[] {
  let sql = `
    SELECT wo.*, an.sensor_id as _sensor_id
    FROM work_orders wo
    JOIN anomalies an ON an.id = wo.anomaly_id
  `;
  const where: string[] = [];
  const params: any[] = [];
  if (filter?.assignee) {
    where.push('wo.assignee = ?');
    params.push(filter.assignee);
  }
  if (filter?.status && filter.status !== 'ALL') {
    where.push('wo.status = ?');
    params.push(filter.status);
  }
  if (filter?.sensorId) {
    where.push('an.sensor_id = ?');
    params.push(filter.sensorId);
  }
  if (filter?.priority && filter.priority !== 'ALL') {
    where.push('wo.priority = ?');
    params.push(filter.priority);
  }
  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY wo.priority = ? DESC, wo.priority = ? DESC, wo.priority = ? DESC, wo.created_at DESC';
  params.push('URGENT', 'HIGH', 'NORMAL');
  const rows: any[] = db.prepare(sql).all(...params);
  return rows.map(rowToWorkOrder);
}

export function reassignWorkOrder(id: string, newAssignee: string, operator: string, remark?: string): WorkOrder {
  const wo = findWorkOrderById(id);
  if (!wo) throw new Error('工单不存在');
  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    throw new Error('已关闭/已取消的工单不能改派');
  }
  if (!newAssignee || newAssignee.trim() === '') {
    throw new Error('新处理人不能为空');
  }
  const before = { assignee: wo.assignee };
  db.prepare(`
    UPDATE work_orders SET assignee = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newAssignee.trim(), id);
  if (remark && remark.trim()) {
    db.prepare('UPDATE work_orders SET remark = COALESCE(remark, \'\') || ? WHERE id = ?')
      .run('\n' + remark.trim(), id);
  }
  const updated = findWorkOrderById(id)!;
  insertWorkOrderHistory(id, 'REASSIGN', operator, before, { assignee: newAssignee.trim() },
    `改派：${wo.assignee} → ${newAssignee.trim()}`);
  insertAuditLog({
    action: 'WORK_ORDER_REASSIGN',
    entityType: 'work_order',
    entityId: id,
    operator,
    before,
    after: { assignee: newAssignee.trim() },
    detail: `工单 ${id.substring(0, 12)} 改派：${wo.assignee} → ${newAssignee.trim()}`,
  });
  return updated;
}

export function updateWorkOrderStatus(
  id: string,
  status: WorkOrderStatus,
  operator: string,
  options?: { closeReason?: string; remark?: string },
): WorkOrder {
  const wo = findWorkOrderById(id);
  if (!wo) throw new Error('工单不存在');
  const before = { status: wo.status };
  if (status === 'CLOSED') {
    if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
      throw new Error('工单已关闭或已取消');
    }
    db.prepare(`
      UPDATE work_orders SET
        status = 'CLOSED',
        closed_at = datetime('now'),
        closed_by = ?,
        close_reason = ?,
        can_reopen = can_reopen,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(operator, options?.closeReason ?? null, id);
    insertWorkOrderHistory(id, 'CLOSE', operator, before, { status: 'CLOSED' },
      `关闭工单：${options?.closeReason || '无原因'}`);
    insertAuditLog({
      action: 'WORK_ORDER_CLOSE',
      entityType: 'work_order',
      entityId: id,
      operator,
      before,
      after: { status: 'CLOSED', closeReason: options?.closeReason },
      detail: `关闭工单 ${id.substring(0, 12)}`,
    });
  } else if (status === 'IN_PROGRESS') {
    if (wo.status !== 'PENDING') {
      throw new Error('只有待处理工单可以转为处理中');
    }
    db.prepare(`
      UPDATE work_orders SET status = 'IN_PROGRESS', updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    insertWorkOrderHistory(id, 'UPDATE', operator, before, { status: 'IN_PROGRESS' }, '状态更新为处理中');
  } else if (status === 'PENDING') {
    if (wo.status !== 'IN_PROGRESS') {
      throw new Error('只有处理中工单可以转回待处理');
    }
    db.prepare(`
      UPDATE work_orders SET status = 'PENDING', updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    insertWorkOrderHistory(id, 'UPDATE', operator, before, { status: 'PENDING' }, '状态转回待处理');
  }
  return findWorkOrderById(id)!;
}

export function reopenWorkOrder(id: string, operator: string): WorkOrder {
  const wo = findWorkOrderById(id);
  if (!wo) throw new Error('工单不存在');
  if (wo.status !== 'CLOSED') {
    throw new Error('只有已关闭的工单可以撤销关闭');
  }
  if (wo.canReopen !== 1) {
    throw new Error('该工单已使用过撤销关闭，不能再次撤销');
  }
  const before = { status: wo.status, canReopen: wo.canReopen };
  db.prepare(`
    UPDATE work_orders SET
      status = 'IN_PROGRESS',
      closed_at = NULL,
      closed_by = NULL,
      close_reason = NULL,
      can_reopen = 0,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  insertWorkOrderHistory(id, 'REOPEN', operator, before,
    { status: 'IN_PROGRESS', canReopen: 0 }, '撤销关闭，恢复为处理中');
  insertAuditLog({
    action: 'WORK_ORDER_REOPEN',
    entityType: 'work_order',
    entityId: id,
    operator,
    before,
    after: { status: 'IN_PROGRESS', canReopen: 0 },
    detail: `撤销关闭工单 ${id.substring(0, 12)}`,
  });
  return findWorkOrderById(id)!;
}

export function updateWorkOrderInfo(
  id: string,
  operator: string,
  updates: { priority?: WorkOrderPriority; deadline?: string; remark?: string; title?: string },
): WorkOrder {
  const wo = findWorkOrderById(id);
  if (!wo) throw new Error('工单不存在');
  if (wo.status === 'CLOSED' || wo.status === 'CANCELLED') {
    throw new Error('已关闭/已取消的工单不能修改');
  }
  const before: any = {};
  const after: any = {};
  const fields: string[] = [];
  const params: any[] = [];
  if (updates.priority && updates.priority !== wo.priority) {
    before.priority = wo.priority;
    after.priority = updates.priority;
    fields.push('priority = ?');
    params.push(updates.priority);
  }
  if (updates.deadline !== undefined && updates.deadline !== wo.deadline) {
    before.deadline = wo.deadline;
    after.deadline = updates.deadline || null;
    fields.push('deadline = ?');
    params.push(updates.deadline || null);
  }
  if (updates.remark !== undefined && updates.remark !== wo.remark) {
    before.remark = wo.remark;
    after.remark = updates.remark || null;
    fields.push('remark = ?');
    params.push(updates.remark || null);
  }
  if (updates.title && updates.title !== wo.title) {
    before.title = wo.title;
    after.title = updates.title;
    fields.push('title = ?');
    params.push(updates.title);
  }
  if (fields.length === 0) return wo;
  fields.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE work_orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  insertWorkOrderHistory(id, 'UPDATE', operator, before, after, '更新工单信息');
  return findWorkOrderById(id)!;
}

export function findWorkOrderHistory(workOrderId: string): WorkOrderHistory[] {
  const rows: any[] = db.prepare(`
    SELECT * FROM work_order_history
    WHERE work_order_id = ?
    ORDER BY created_at DESC
  `).all(workOrderId);
  return rows.map(rowToWorkOrderHistory);
}

export function findAllAssignees(): string[] {
  const rows: any[] = db.prepare(`
    SELECT DISTINCT assignee FROM work_orders
    WHERE assignee IS NOT NULL AND assignee != ''
    ORDER BY assignee
  `).all();
  return rows.map((r) => r.assignee);
}

function insertWorkOrderHistory(
  workOrderId: string,
  action: WorkOrderAction,
  operator: string,
  before: any,
  after: any,
  detail?: string,
): void {
  const id = generateId('woh_');
  db.prepare(`
    INSERT INTO work_order_history (id, work_order_id, action, operator, before_json, after_json, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workOrderId, action, operator,
    before != null ? JSON.stringify(before) : null,
    after != null ? JSON.stringify(after) : null,
    detail ?? null,
  );
}

function rowToWorkOrder(row: any): WorkOrder {
  const history = db.prepare(`
    SELECT * FROM work_order_history
    WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(row.id);
  return {
    id: row.id,
    anomalyId: row.anomaly_id,
    anomaly: findAnomalyById(row.anomaly_id) || undefined,
    title: row.title,
    priority: row.priority as WorkOrderPriority,
    status: row.status as WorkOrderStatus,
    assignee: row.assignee,
    creator: row.creator,
    deadline: row.deadline ?? undefined,
    remark: row.remark ?? undefined,
    closedAt: row.closed_at ?? undefined,
    closedBy: row.closed_by ?? undefined,
    closeReason: row.close_reason ?? undefined,
    canReopen: row.can_reopen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestHistory: history ? rowToWorkOrderHistory(history) : undefined,
  };
}

function rowToWorkOrderHistory(row: any): WorkOrderHistory {
  let beforeJson: any = undefined;
  let afterJson: any = undefined;
  try { if (row.before_json) beforeJson = JSON.parse(row.before_json); } catch { /* ignore */ }
  try { if (row.after_json) afterJson = JSON.parse(row.after_json); } catch { /* ignore */ }
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    action: row.action as WorkOrderAction,
    operator: row.operator,
    beforeJson,
    afterJson,
    detail: row.detail ?? undefined,
    createdAt: row.created_at,
  };
}

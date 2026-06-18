import { Router, type Request, type Response } from 'express';
import {
  createWorkOrder, findWorkOrderById, findAllWorkOrders,
  reassignWorkOrder, updateWorkOrderStatus, reopenWorkOrder,
  updateWorkOrderInfo, findWorkOrderHistory, findAllAssignees,
} from '../repositories/WorkOrderRepo.js';
import type {
  WorkOrderPriority, WorkOrderStatus, WorkOrderFilter,
} from '../../shared/types.js';
import {
  WORK_ORDER_PRIORITY_LABELS, WORK_ORDER_STATUS_LABELS,
  ANOMALY_TYPE_LABELS,
} from '../../shared/types.js';

const router = Router();

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

router.get('/', (req: Request, res: Response) => {
  const { assignee, status, sensorId, priority } = req.query as {
    assignee?: string; status?: string; sensorId?: string; priority?: string;
  };
  const filter: WorkOrderFilter = {};
  if (assignee) filter.assignee = assignee;
  if (status) filter.status = status as any;
  if (sensorId) filter.sensorId = sensorId;
  if (priority) filter.priority = priority as any;
  const orders = findAllWorkOrders(Object.keys(filter).length > 0 ? filter : undefined);
  res.json({ success: true, data: orders });
});

router.get('/assignees', (_req: Request, res: Response) => {
  res.json({ success: true, data: findAllAssignees() });
});

router.get('/export/csv', (req: Request, res: Response) => {
  const { assignee, status, sensorId, priority } = req.query as {
    assignee?: string; status?: string; sensorId?: string; priority?: string;
  };
  const filter: WorkOrderFilter = {};
  if (assignee) filter.assignee = assignee;
  if (status) filter.status = status as any;
  if (sensorId) filter.sensorId = sensorId;
  if (priority) filter.priority = priority as any;
  const orders = findAllWorkOrders(Object.keys(filter).length > 0 ? filter : undefined);

  const header = [
    '工单ID', '标题', '优先级', '状态', '创建人', '处理人', '关联异常ID',
    '传感器', '异常类型', '异常描述', '截止时间', '创建时间', '更新时间',
    '关闭时间', '关闭人', '关闭原因', '备注',
  ];
  const rows = orders.map((wo) => [
    wo.id,
    wo.title,
    WORK_ORDER_PRIORITY_LABELS[wo.priority],
    WORK_ORDER_STATUS_LABELS[wo.status],
    wo.creator,
    wo.assignee,
    wo.anomalyId,
    wo.anomaly?.sensorName || '',
    wo.anomaly ? (ANOMALY_TYPE_LABELS as any)[wo.anomaly.type] || wo.anomaly.type : '',
    wo.anomaly?.description || '',
    wo.deadline || '',
    wo.createdAt,
    wo.updatedAt,
    wo.closedAt || '',
    wo.closedBy || '',
    wo.closeReason || '',
    wo.remark || '',
  ]);
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const filename = `work_orders_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.post('/export/csv', (req: Request, res: Response) => {
  const body = req.body as WorkOrderFilter | undefined;
  const orders = findAllWorkOrders(body);
  const header = [
    '工单ID', '标题', '优先级', '状态', '创建人', '处理人', '关联异常ID',
    '传感器', '异常类型', '异常描述', '截止时间', '创建时间', '更新时间',
    '关闭时间', '关闭人', '关闭原因', '备注',
  ];
  const rows = orders.map((wo) => [
    wo.id,
    wo.title,
    WORK_ORDER_PRIORITY_LABELS[wo.priority],
    WORK_ORDER_STATUS_LABELS[wo.status],
    wo.creator,
    wo.assignee,
    wo.anomalyId,
    wo.anomaly?.sensorName || '',
    wo.anomaly ? (ANOMALY_TYPE_LABELS as any)[wo.anomaly.type] || wo.anomaly.type : '',
    wo.anomaly?.description || '',
    wo.deadline || '',
    wo.createdAt,
    wo.updatedAt,
    wo.closedAt || '',
    wo.closedBy || '',
    wo.closeReason || '',
    wo.remark || '',
  ]);
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const filename = `work_orders_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      anomalyId: string;
      title: string;
      priority: WorkOrderPriority;
      assignee: string;
      creator: string;
      deadline?: string;
      remark?: string;
    };
    if (!body.anomalyId || !body.title || !body.assignee || !body.creator) {
      res.status(400).json({ success: false, error: '异常ID、标题、处理人、创建人不能为空' });
      return;
    }
    const validPriorities: WorkOrderPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    if (!validPriorities.includes(body.priority || 'NORMAL')) {
      res.status(400).json({ success: false, error: '无效的优先级' });
      return;
    }
    const wo = createWorkOrder({
      anomalyId: body.anomalyId,
      title: body.title.trim(),
      priority: body.priority || 'NORMAL',
      assignee: body.assignee.trim(),
      creator: body.creator.trim(),
      deadline: body.deadline,
      remark: body.remark,
    });
    res.status(201).json({ success: true, data: wo });
  } catch (e: any) {
    if (e.code === 'CONFLICT') {
      res.status(409).json({
        success: false,
        error: e.message,
        conflict: true,
        conflictWorkOrder: e.conflictWorkOrder,
      });
      return;
    }
    res.status(400).json({ success: false, error: e.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const wo = findWorkOrderById(req.params.id);
  if (!wo) {
    res.status(404).json({ success: false, error: '工单不存在' });
    return;
  }
  res.json({ success: true, data: wo });
});

router.get('/:id/history', (req: Request, res: Response) => {
  const wo = findWorkOrderById(req.params.id);
  if (!wo) {
    res.status(404).json({ success: false, error: '工单不存在' });
    return;
  }
  const history = findWorkOrderHistory(req.params.id);
  res.json({ success: true, data: history });
});

router.put('/:id/reassign', (req: Request, res: Response) => {
  try {
    const { assignee, operator, remark } = req.body as {
      assignee: string; operator: string; remark?: string;
    };
    if (!assignee || !operator) {
      res.status(400).json({ success: false, error: '新处理人和操作人不能为空' });
      return;
    }
    const wo = reassignWorkOrder(req.params.id, assignee, operator, remark);
    res.json({ success: true, data: wo });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put('/:id/status', (req: Request, res: Response) => {
  try {
    const { status, operator, closeReason } = req.body as {
      status: WorkOrderStatus; operator: string; closeReason?: string;
    };
    if (!status || !operator) {
      res.status(400).json({ success: false, error: '状态和操作人不能为空' });
      return;
    }
    const validStatuses: WorkOrderStatus[] = ['PENDING', 'IN_PROGRESS', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: '无效的状态值' });
      return;
    }
    const wo = updateWorkOrderStatus(req.params.id, status, operator, { closeReason });
    res.json({ success: true, data: wo });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.post('/:id/reopen', (req: Request, res: Response) => {
  try {
    const { operator } = req.body as { operator: string };
    if (!operator) {
      res.status(400).json({ success: false, error: '操作人不能为空' });
      return;
    }
    const wo = reopenWorkOrder(req.params.id, operator);
    res.json({ success: true, data: wo });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      operator: string;
      priority?: WorkOrderPriority;
      deadline?: string;
      remark?: string;
      title?: string;
    };
    if (!body.operator) {
      res.status(400).json({ success: false, error: '操作人不能为空' });
      return;
    }
    const wo = updateWorkOrderInfo(req.params.id, body.operator, {
      priority: body.priority,
      deadline: body.deadline,
      remark: body.remark,
      title: body.title,
    });
    res.json({ success: true, data: wo });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ROOT = path.resolve(__dirname, '..', 'test-runtime');
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const TEST_DB = path.join(TEST_DATA_DIR, 'test_workorder_qc.db');

function setupEnv() {
  if (!fs.existsSync(TEST_ROOT)) fs.mkdirSync(TEST_ROOT, { recursive: true });
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  process.env.QC_DATA_DIR = TEST_DATA_DIR;
  process.env.QC_DB_PATH = TEST_DB;
}

setupEnv();

async function loadModules() {
  const ImportSvc = await import('../api/services/ImportService.js');
  const AnomalyRepo = await import('../api/repositories/AnomalyRepo.js');
  const WorkOrderRepo = await import('../api/repositories/WorkOrderRepo.js');
  const ConfigRepo = await import('../api/repositories/ConfigRepo.js');
  const AuditRepo = await import('../api/repositories/AuditLogRepo.js');
  const WoRoutes = await import('../api/routes/workorders.js');
  void WoRoutes;
  return {
    importSampleData: ImportSvc.importSampleData,
    findAllAnomalies: AnomalyRepo.findAllAnomalies,
    createWorkOrder: WorkOrderRepo.createWorkOrder,
    findWorkOrderById: WorkOrderRepo.findWorkOrderById,
    findAllWorkOrders: WorkOrderRepo.findAllWorkOrders,
    reassignWorkOrder: WorkOrderRepo.reassignWorkOrder,
    updateWorkOrderStatus: WorkOrderRepo.updateWorkOrderStatus,
    reopenWorkOrder: WorkOrderRepo.reopenWorkOrder,
    updateWorkOrderInfo: WorkOrderRepo.updateWorkOrderInfo,
    findWorkOrderHistory: WorkOrderRepo.findWorkOrderHistory,
    findAllAssignees: WorkOrderRepo.findAllAssignees,
    saveAppState: ConfigRepo.saveAppState,
    getAppState: ConfigRepo.getAppState,
    findRecentAuditLogs: AuditRepo.findRecentAuditLogs,
  };
}

type Mods = Awaited<ReturnType<typeof loadModules>>;

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

describe('复测工单模块集成测试', () => {
  let m: Mods;
  let anomalyIds: string[] = [];

  before(async () => {
    m = await loadModules();
    const res = m.importSampleData();
    assert.ok(res.success, '样例数据导入应成功');
    const anomalies = m.findAllAnomalies();
    assert.ok(anomalies.length >= 7, '样例数据应产生至少 7 条异常');
    anomalyIds = anomalies.slice(0, 7).map((a) => a.id);
  });

  after(() => {
    for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  // ========= 1. 创建工单 + 冲突检测 =========
  describe('1. 工单创建与冲突检测', () => {
    it('创建工单成功：字段完整记录，历史写入', () => {
      const wo = m.createWorkOrder({
        anomalyId: anomalyIds[0],
        title: '测试工单-冷库温度越限',
        priority: 'HIGH',
        assignee: '处理人甲',
        creator: '质控员A',
        deadline: '2026-06-30T18:00:00',
        remark: '请优先处理，影响药品存储',
      });
      assert.ok(wo.id, '工单ID应生成');
      assert.equal(wo.title, '测试工单-冷库温度越限');
      assert.equal(wo.priority, 'HIGH');
      assert.equal(wo.status, 'PENDING');
      assert.equal(wo.assignee, '处理人甲');
      assert.equal(wo.creator, '质控员A');
      assert.equal(wo.deadline, '2026-06-30T18:00:00');
      assert.ok(wo.anomaly, '应关联异常对象');
      assert.equal(wo.anomalyId, anomalyIds[0]);
      assert.equal(wo.canReopen, 1, 'canReopen 初始为 1');

      const history = m.findWorkOrderHistory(wo.id);
      assert.ok(history.length >= 1, '至少有一条创建历史');
      assert.equal(history[0].action, 'CREATE');
      assert.equal(history[0].operator, '质控员A');
    });

    it('同一条异常重复创建工单：抛出 CONFLICT 错误', () => {
      let threw = false;
      let conflictCode: string | undefined;
      try {
        m.createWorkOrder({
          anomalyId: anomalyIds[0],
          title: '重复工单-不应该创建',
          priority: 'NORMAL',
          assignee: '处理人乙',
          creator: '质控员B',
        });
      } catch (e: any) {
        threw = true;
        conflictCode = e.code;
        assert.ok(e.conflictWorkOrder, '应返回冲突工单对象');
        assert.equal(e.conflictWorkOrder.anomalyId, anomalyIds[0]);
      }
      assert.ok(threw, '应抛出异常');
      assert.equal(conflictCode, 'CONFLICT', '错误码应为 CONFLICT');

      const all = m.findAllWorkOrders();
      const count = all.filter((w) => w.anomalyId === anomalyIds[0]).length;
      assert.equal(count, 1, '数据库中应只有 1 条关联该异常的工单');
    });

    it('异常关闭后重新创建工单：允许（状态不冲突）', () => {
      const first = m.findAllWorkOrders().find((w) => w.anomalyId === anomalyIds[0])!;
      m.updateWorkOrderStatus(first.id, 'CLOSED', '质控员A', { closeReason: '复测完成，温度已恢复正常' });

      const second = m.createWorkOrder({
        anomalyId: anomalyIds[0],
        title: '复测工单-温度再次越限',
        priority: 'URGENT',
        assignee: '处理人丙',
        creator: '质控员A',
      });
      assert.ok(second.id, '关闭后应允许创建新工单');
      assert.notEqual(second.id, first.id, '应为不同的工单ID');

      const all = m.findAllWorkOrders();
      const count = all.filter((w) => w.anomalyId === anomalyIds[0]).length;
      assert.equal(count, 2, '应允许存在多条（含关闭的）');
    });
  });

  // ========= 2. 状态流转与改派 =========
  describe('2. 状态流转、改派与历史记录', () => {
    let woId: string;

    before(() => {
      const wo = m.createWorkOrder({
        anomalyId: anomalyIds[1],
        title: '状态流转测试工单',
        priority: 'NORMAL',
        assignee: '初始处理人',
        creator: '测试员',
      });
      woId = wo.id;
    });

    it('PENDING → IN_PROGRESS 合法流转', () => {
      const updated = m.updateWorkOrderStatus(woId, 'IN_PROGRESS', '初始处理人');
      assert.equal(updated.status, 'IN_PROGRESS');
      const history = m.findWorkOrderHistory(woId);
      const update = history.find((h) => h.action === 'UPDATE');
      assert.ok(update, '应有 UPDATE 历史');
    });

    it('IN_PROGRESS → PENDING 回转合法', () => {
      const updated = m.updateWorkOrderStatus(woId, 'PENDING', '初始处理人');
      assert.equal(updated.status, 'PENDING');
    });

    it('直接 PENDING → CLOSED 合法', () => {
      const updated = m.updateWorkOrderStatus(woId, 'CLOSED', '测试员', { closeReason: '流程测试关闭' });
      assert.equal(updated.status, 'CLOSED');
      assert.equal(updated.closedBy, '测试员');
      assert.equal(updated.closeReason, '流程测试关闭');
      assert.ok(updated.closedAt, '应有关闭时间');
    });

    it('已关闭工单不允许再改派', () => {
      let threw = false;
      try {
        m.reassignWorkOrder(woId, '新处理人', '测试员');
      } catch {
        threw = true;
      }
      assert.ok(threw, '已关闭工单改派应失败');
    });

    it('改派工单：更新处理人，写入历史', () => {
      const wo = m.createWorkOrder({
        anomalyId: anomalyIds[2],
        title: '改派测试工单',
        priority: 'LOW',
        assignee: '张三',
        creator: '测试员',
      });
      const reassigned = m.reassignWorkOrder(wo.id, '李四', '管理员', '人员调整');
      assert.equal(reassigned.assignee, '李四');
      const history = m.findWorkOrderHistory(wo.id);
      const reassign = history.find((h) => h.action === 'REASSIGN');
      assert.ok(reassign, '应有 REASSIGN 历史');
      assert.equal((reassign.beforeJson as any).assignee, '张三');
      assert.equal((reassign.afterJson as any).assignee, '李四');
    });

    it('findAllAssignees 返回去重后的处理人列表', () => {
      const assignees = m.findAllAssignees();
      assert.ok(assignees.includes('李四'), '应包含李四');
      assert.ok(assignees.includes('处理人甲'), '应包含处理人甲');
    });
  });

  // ========= 3. 撤销关闭（仅允许一次） =========
  describe('3. 撤销关闭（单次权限）', () => {
    let woId: string;

    before(() => {
      const wo = m.createWorkOrder({
        anomalyId: anomalyIds[3],
        title: '撤销关闭测试',
        priority: 'NORMAL',
        assignee: '王五',
        creator: '测试员',
      });
      woId = wo.id;
      m.updateWorkOrderStatus(woId, 'CLOSED', '测试员', { closeReason: '误关闭' });
    });

    it('撤销关闭成功：状态恢复为 IN_PROGRESS，canReopen 变为 0', () => {
      const reopened = m.reopenWorkOrder(woId, '测试员');
      assert.equal(reopened.status, 'IN_PROGRESS');
      assert.equal(reopened.canReopen, 0);
      assert.equal(reopened.closedAt, undefined);
      assert.equal(reopened.closedBy, undefined);
      assert.equal(reopened.closeReason, undefined);

      const history = m.findWorkOrderHistory(woId);
      const reopen = history.find((h) => h.action === 'REOPEN');
      assert.ok(reopen, '应有 REOPEN 历史');
      assert.equal(reopen.operator, '测试员');
    });

    it('再次撤销关闭：拒绝，canReopen=0 不可再撤销', () => {
      m.updateWorkOrderStatus(woId, 'CLOSED', '测试员', { closeReason: '再次关闭' });
      let threw = false;
      try {
        m.reopenWorkOrder(woId, '测试员');
      } catch {
        threw = true;
      }
      assert.ok(threw, '第二次撤销应被拒绝');
      const final = m.findWorkOrderById(woId)!;
      assert.equal(final.status, 'CLOSED', '状态保持已关闭');
    });
  });

  // ========= 4. 筛选 + 跨重启持久化 =========
  describe('4. 筛选条件与跨重启恢复', () => {
    before(() => {
      const filterAnomalies = [anomalyIds[4], anomalyIds[5], anomalyIds[1]];
      for (let i = 0; i < 3; i++) {
        m.createWorkOrder({
          anomalyId: filterAnomalies[i],
          title: `筛选测试-${i}`,
          priority: i === 0 ? 'URGENT' : i === 1 ? 'HIGH' : 'NORMAL',
          assignee: i === 0 ? '筛选员A' : '筛选员B',
          creator: '测试员',
        });
      }
    });

    it('findAllWorkOrders 按 assignee 过滤', () => {
      const filtered = m.findAllWorkOrders({ assignee: '筛选员A' });
      assert.ok(filtered.length >= 1);
      for (const wo of filtered) {
        assert.equal(wo.assignee, '筛选员A');
      }
    });

    it('findAllWorkOrders 按 status 过滤', () => {
      const pending = m.findAllWorkOrders({ status: 'PENDING' });
      for (const wo of pending) {
        assert.equal(wo.status, 'PENDING');
      }
      assert.ok(pending.length > 0, '待处理工单应存在');
    });

    it('findAllWorkOrders 按 priority 过滤', () => {
      const urgent = m.findAllWorkOrders({ priority: 'URGENT' });
      for (const wo of urgent) {
        assert.equal(wo.priority, 'URGENT');
      }
    });

    it('按 sensorId 过滤工单', () => {
      const anomalies = m.findAllAnomalies();
      if (anomalies.length > 0) {
        const sensorId = anomalies[0].sensorId;
        const filtered = m.findAllWorkOrders({ sensorId });
        for (const wo of filtered) {
          assert.equal(wo.anomaly?.sensorId, sensorId);
        }
      }
    });

    it('saveAppState / getAppState：workOrderFilter 持久化（模拟重启）', () => {
      const original = m.getAppState();
      try {
        const saved = m.saveAppState({
          selectedSensorId: original.selectedSensorId,
          statusFilter: original.statusFilter,
          timeRange: original.timeRange,
          customStart: original.customStart,
          customEnd: original.customEnd,
          view: original.view,
          workOrderFilter: { assignee: '筛选员A', status: 'PENDING', priority: 'HIGH' },
        });
        assert.equal((saved as any).workOrderFilter?.assignee, '筛选员A');
        assert.equal((saved as any).workOrderFilter?.status, 'PENDING');
        assert.equal((saved as any).workOrderFilter?.priority, 'HIGH');

        const restored = m.getAppState();
        assert.equal((restored as any).workOrderFilter?.assignee, '筛选员A', '重启后 assignee 恢复');
        assert.equal((restored as any).workOrderFilter?.status, 'PENDING', '重启后 status 恢复');
        assert.equal((restored as any).workOrderFilter?.priority, 'HIGH', '重启后 priority 恢复');
      } finally {
        m.saveAppState(original);
      }
    });
  });

  // ========= 5. CSV 导出 =========
  describe('5. 工单 CSV 导出', () => {
    it('工单数据序列化正确，CSV 包含必要列', () => {
      const orders = m.findAllWorkOrders();
      assert.ok(orders.length > 0, '应有工单数据');

      const header = [
        '工单ID', '标题', '优先级', '状态', '创建人', '处理人', '关联异常ID',
        '传感器', '异常类型', '异常描述', '截止时间', '创建时间', '更新时间',
        '关闭时间', '关闭人', '关闭原因', '备注',
      ];
      const rows = orders.map((wo) => [
        wo.id, wo.title, wo.priority, wo.status, wo.creator, wo.assignee, wo.anomalyId,
        wo.anomaly?.sensorName || '', wo.anomaly?.type || '', wo.anomaly?.description || '',
        wo.deadline || '', wo.createdAt, wo.updatedAt,
        wo.closedAt || '', wo.closedBy || '', wo.closeReason || '', wo.remark || '',
      ]);
      const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');

      assert.ok(csv.startsWith('\uFEFF'), 'CSV 应有 UTF-8 BOM');
      assert.ok(csv.includes('工单ID'), '应包含表头');
      assert.ok(csv.includes('优先级'), '应包含优先级列');
      for (const wo of orders) {
        assert.ok(csv.includes(wo.id), `CSV 应包含工单 ${wo.id}`);
        assert.ok(csv.includes(wo.title), `CSV 应包含标题 ${wo.title}`);
      }
    });

    it('筛选后导出的 CSV 条数与筛选数量一致', () => {
      const filtered = m.findAllWorkOrders({ status: 'PENDING' });
      const csvData = filtered.map((wo) => [
        wo.id, wo.title, wo.priority, wo.status,
      ]);
      const csv = csvData.map((r) => r.map(csvEscape).join(',')).join('\n');
      const lines = csv.split('\n').filter((l) => l.trim().length > 0);
      assert.equal(lines.length, filtered.length, 'CSV 数据行数应等于筛选结果数');
    });
  });

  // ========= 6. 审计日志 =========
  describe('6. 工单审计日志写入', () => {
    it('WORK_ORDER_CREATE / WORK_ORDER_CLOSE / WORK_ORDER_REOPEN / WORK_ORDER_REASSIGN 写入 audit_logs', () => {
      const logs = m.findRecentAuditLogs(200);
      const actions = new Set(logs.map((l) => l.action));
      assert.ok(actions.has('WORK_ORDER_CREATE'), '应有 WORK_ORDER_CREATE 日志');
      assert.ok(actions.has('WORK_ORDER_CLOSE'), '应有 WORK_ORDER_CLOSE 日志');
      assert.ok(actions.has('WORK_ORDER_REOPEN'), '应有 WORK_ORDER_REOPEN 日志');
      assert.ok(actions.has('WORK_ORDER_REASSIGN'), '应有 WORK_ORDER_REASSIGN 日志');

      const creates = logs.filter((l) => l.action === 'WORK_ORDER_CREATE');
      assert.ok(creates.length > 0, '至少一条创建日志');
      const first = creates[0];
      assert.ok(first.entityId, 'entityId 存在');
      assert.ok(first.operator, 'operator 存在');
      assert.ok(first.after, 'after 字段存在');
    });
  });

  // ========= 7. 回归验证：不破坏原有功能 =========
  describe('7. 回归：不破坏标注、阈值、报表等原功能', () => {
    it('工单创建不影响原异常 hasManualOverride 状态', () => {
      const before = m.findAllAnomalies().find((a) => a.id === anomalyIds[6])!;
      const originalOverride = before.hasManualOverride;

      m.createWorkOrder({
        anomalyId: anomalyIds[6],
        title: '回归测试-不影响标注',
        priority: 'LOW',
        assignee: '回归测试员',
        creator: '测试员',
      });

      const after = m.findAllAnomalies().find((x) => x.id === anomalyIds[6])!;
      assert.equal(after.hasManualOverride, originalOverride,
        '创建工单不应修改 hasManualOverride');
    });

    it('工单筛选不影响异常筛选状态', () => {
      const originalState = m.getAppState();
      m.saveAppState({
        ...originalState,
        statusFilter: 'ACCEPTED',
        workOrderFilter: { status: 'CLOSED' },
      });
      const restored = m.getAppState();
      assert.equal(restored.statusFilter, 'ACCEPTED',
        '异常筛选状态不被工单筛选覆盖');
      assert.equal((restored as any).workOrderFilter?.status, 'CLOSED',
        '工单筛选独立保存');
      m.saveAppState(originalState);
    });
  });
});

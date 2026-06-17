import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ROOT = path.resolve(__dirname, '..', 'test-runtime');
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const TEST_DB = path.join(TEST_DATA_DIR, 'test_qc.db');

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
  const ReportSvc = await import('../api/services/ReportService.js');
  const SensorRepo = await import('../api/repositories/SensorRepo.js');
  const AnomalyRepo = await import('../api/repositories/AnomalyRepo.js');
  const AnnotationRepo = await import('../api/repositories/AnnotationRepo.js');
  const ConfigRepo = await import('../api/repositories/ConfigRepo.js');
  const AuditRepo = await import('../api/repositories/AuditLogRepo.js');
  const Detector = await import('../api/services/AnomalyDetector.js');
  const fileHash = await import('../api/utils/fileHash.js');
  return {
    importSampleData: ImportSvc.importSampleData,
    importContent: ImportSvc.importContent,
    generateCsvReport: ReportSvc.generateCsvReport,
    generatePdfReport: ReportSvc.generatePdfReport,
    findAllSensors: SensorRepo.findAllSensors,
    findAllAnomalies: AnomalyRepo.findAllAnomalies,
    findAnomalyById: AnomalyRepo.findAnomalyById,
    insertAnnotation: AnnotationRepo.insertAnnotation,
    rollbackLatestAnnotation: AnnotationRepo.rollbackLatestAnnotation,
    findAnnotationHistory: AnnotationRepo.findAnnotationHistory,
    getAppState: ConfigRepo.getAppState,
    saveAppState: ConfigRepo.saveAppState,
    getThresholdConfig: ConfigRepo.getThresholdConfig,
    updateThresholdConfig: ConfigRepo.updateThresholdConfig,
    findRecentAuditLogs: AuditRepo.findRecentAuditLogs,
    runFullDetection: Detector.runFullDetection,
    generateId: fileHash.generateId,
  };
}

type Mods = Awaited<ReturnType<typeof loadModules>>;

describe('传感器质控看板 - 复核闭环集成测试', () => {
  let m: Mods;

  before(async () => {
    m = await loadModules();
  });

  after(() => {
    for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  // ========= 1. 数据导入 =========
  describe('1. 数据导入', () => {
    it('导入样例数据成功：5台传感器、约2万条读数', () => {
      const res = m.importSampleData();
      assert.ok(res.success, '导入应成功: ' + (res.message || ''));
      assert.equal(res.sensorIds.length, 5, '应为 5 台传感器');
      assert.ok(res.validRows > 10000, `有效行(${res.validRows})应 > 1万`);

      const sensors = m.findAllSensors();
      assert.equal(sensors.length, 5, 'Repo 查询也应返回 5 台');
      const totalRows = sensors.reduce((s, x) => s + (x.readingCount || 0), 0);
      assert.ok(totalRows >= res.validRows, '传感器读数计数应匹配');
    });

    it('重复导入完全相同内容被拒绝：file_hash 去重', () => {
      // 第一次导入实际已经在上面执行了，但再导入一次仍应被拒绝
      const second = m.importSampleData();
      assert.equal(second.success, false, '重复导入应失败');
      assert.ok(second.duplicateBatch === true, '应标记为重复批次');
      assert.match(second.message || '', /已存在|重复/, '消息应提示重复');
    });

    it('导入后产生异常，所有异常均属于已知传感器', () => {
      const anomalies = m.findAllAnomalies();
      assert.ok(anomalies.length >= 5, '样例数据应至少产生 5+ 条异常（实际植入 + 随机）');
      const sensorIds = new Set(m.findAllSensors().map((s) => s.id));
      for (const a of anomalies) {
        assert.ok(sensorIds.has(a.sensorId),
          `异常 ${a.id} 的 sensorId ${a.sensorId} 应存在`);
      }
    });
  });

  // ========= 2. 筛选 + 导出一致性 =========
  describe('2. 筛选与导出一致性', () => {
    let firstSensorId: string;

    before(() => {
      firstSensorId = m.findAllSensors()[0].id;
    });

    it('findAllAnomalies 按 sensorId 过滤：只返回指定传感器异常', () => {
      const all = m.findAllAnomalies();
      const filtered = m.findAllAnomalies(firstSensorId);
      assert.ok(filtered.length > 0, '第一台传感器应有异常');
      assert.ok(filtered.length <= all.length, '筛选后数量应不超过全部');
      for (const a of filtered) {
        assert.equal(a.sensorId, firstSensorId,
          `筛选后异常 ${a.id} 传感器应为 ${firstSensorId}`);
      }
    });

    it('findAllAnomalies 按 statusFilter=DETECTED 过滤', () => {
      const withDetected = m.findAllAnomalies(undefined, 'DETECTED');
      for (const a of withDetected) {
        const status = a.latestAnnotation?.rolledBackAt
          ? 'DETECTED'
          : (a.latestAnnotation?.status || 'DETECTED');
        assert.equal(status, 'DETECTED', `筛选 DETECTED 不应包含 ${status}`);
      }
    });

    it('findAllAnomalies 按时间范围过滤：只返回范围内的异常', () => {
      // 样例数据 2025-05-01 ~ 2025-05-07
      const all = m.findAllAnomalies();
      const inRange = m.findAllAnomalies(undefined, 'ALL', {
        start: '2025-05-01T00:00:00.000Z',
        end: '2025-05-03T23:59:59.999Z',
      });
      assert.ok(inRange.length <= all.length, '时间筛选数量应减少');
      for (const a of inRange) {
        assert.ok(
          a.reading?.timestamp && a.reading.timestamp >= '2025-05-01'
          && a.reading.timestamp <= '2025-05-04',
          `异常 ${a.id} 时间 ${a.reading?.timestamp} 超出范围`,
        );
      }
    });

    it('CSV 导出：sensorId 筛选后 CSV 只含对应传感器', () => {
      const csv = m.generateCsvReport({ sensorId: firstSensorId });
      const lines = csv.split('\n');
      // 校验没有其他传感器 ID
      const otherSensors = m.findAllSensors()
        .filter((s) => s.id !== firstSensorId)
        .map((s) => s.id);
      for (const line of lines) {
        for (const other of otherSensors) {
          if (line.includes(other)) {
            // 仅出现在分隔符中的其他列内容不判定，只看传感器ID列
            // 简单检查：CSV 第 3 列是传感器ID
            const cols = line.split(',');
            if (cols.length >= 3 && cols[2].includes(other)) {
              assert.fail(`CSV 中不应出现传感器 ${other} 行: ${line.substring(0, 100)}`);
            }
          }
        }
      }
      assert.ok(csv.includes(firstSensorId), 'CSV 中应包含选中传感器');
    });

    it('CSV 导出：状态筛选 ACCEPTED 后 CSV 只含已接受记录（先标注再验证）', () => {
      const anomalies = m.findAllAnomalies(firstSensorId, 'DETECTED');
      assert.ok(anomalies.length >= 1, '至少要有 1 条待处理异常用于标注');
      const target = anomalies[0];
      m.insertAnnotation({
        id: m.generateId('ann_test_'),
        anomalyId: target.id,
        status: 'ACCEPTED',
        handler: '测试员A',
        reason: '自动化测试：确认异常',
      });
      const csv = m.generateCsvReport({
        sensorId: firstSensorId,
        statusFilter: 'ACCEPTED',
      });
      assert.match(csv, /测试员A/, 'CSV 中应包含处理人 测试员A');
      assert.match(csv, /已接受/, 'CSV 状态列应显示 已接受');
    });
  });

  // ========= 3. 标注与回滚 =========
  describe('3. 标注与回滚闭环', () => {
    it('插入标注：处理人、原因被记录，异常被标记 hasManualOverride', () => {
      const anomalies = m.findAllAnomalies(undefined, 'DETECTED');
      assert.ok(anomalies.length >= 2, '需要至少 2 条待处理异常');
      const a = anomalies[0];
      const ann = m.insertAnnotation({
        id: m.generateId('ann_rb_'),
        anomalyId: a.id,
        status: 'FALSE_POSITIVE',
        handler: '质控员张三',
        reason: '现场复核，确认误报，空调外机附近',
      });
      assert.equal(ann.handler, '质控员张三', '返回标注处理人一致');
      assert.equal(ann.status, 'FALSE_POSITIVE', '状态为误报');
      const updated = m.findAnomalyById(a.id)!;
      assert.equal(updated.hasManualOverride, 1, 'has_manual_override 应为 1');
      assert.equal(updated.latestAnnotation?.handler, '质控员张三', '最新标注一致');
    });

    it('回滚最近一次标注：状态恢复，保留回滚原因、历史可查', () => {
      const before = m.findAllAnomalies(undefined, 'DETECTED').length;
      const result = m.rollbackLatestAnnotation('自动化测试：操作失误回滚');
      assert.ok(result, '应返回回滚后的标注');
      assert.ok(result.rolledBackAt != null, 'rolledBackAt 应有值');
      assert.equal(result.rollbackReason, '自动化测试：操作失误回滚', '回滚原因被记录');
      const after = m.findAllAnomalies(undefined, 'DETECTED').length;
      assert.equal(after, before + 1, '回滚后待处理异常数量应 +1');

      const history = m.findAnnotationHistory(10);
      const rolled = history.find((h) => h.id === result.id);
      assert.ok(rolled, '历史中应包含该标注');
      assert.ok(rolled.rolledBackAt != null, '历史中 rolledBackAt 不为空');
    });

    it('连续回滚多次：应可以回滚更早的标注', () => {
      const anomalies = m.findAllAnomalies(undefined, 'DETECTED');
      for (let i = 0; i < 2; i++) {
        m.insertAnnotation({
          id: m.generateId('ann_multi_'),
          anomalyId: anomalies[i].id,
          status: 'RETEST',
          handler: '连续回滚测试',
          reason: `第 ${i + 1} 条`,
        });
      }
      const h1 = m.findAnnotationHistory(2);
      assert.equal(h1.length, 2, '刚插入 2 条新标注');
      m.rollbackLatestAnnotation('撤销第2条');
      m.rollbackLatestAnnotation('撤销第1条');
      const h2 = m.findAnnotationHistory(2);
      assert.ok(h2.every((x) => x.rolledBackAt != null), '两条都应被回滚');
    });
  });

  // ========= 4. 阈值重算不冲掉人工标注 =========
  describe('4. 阈值修改 & 重复导入保护人工结论', () => {
    let protectedAnomalyId: string;

    before(() => {
      const candidates = m.findAllAnomalies(undefined, 'DETECTED');
      assert.ok(candidates.length >= 1, '需要至少 1 条待处理异常');
      const a = candidates[0];
      m.insertAnnotation({
        id: m.generateId('ann_protect_'),
        anomalyId: a.id,
        status: 'PENDING',
        handler: '保护测试员',
        reason: '这条必须保留！重算不能覆盖',
      });
      protectedAnomalyId = a.id;
    });

    it('阈值修改触发重算：带标注的异常 hasManualOverride=1 不被删除', () => {
      const before = m.findAnomalyById(protectedAnomalyId)!;
      assert.equal(before.hasManualOverride, 1, '标注后 hasManualOverride 已为 1');
      const oldHandler = before.latestAnnotation?.handler;
      const oldReason = before.latestAnnotation?.reason;

      const old = m.getThresholdConfig();
      const modified = { ...old, tempMax: old.tempMax + 2 };
      m.updateThresholdConfig(modified);
      const stats = m.runFullDetection(modified, { beforeThreshold: old });
      assert.ok(stats.protectedCount >= 1,
        `stats.protectedCount (${stats.protectedCount}) 应至少为 1`);

      const after = m.findAnomalyById(protectedAnomalyId);
      assert.ok(after != null, '受保护异常在重算后不能消失');
      assert.equal(after!.hasManualOverride, 1, '保护标志仍为 1');
      assert.equal(after!.latestAnnotation?.handler, oldHandler, '处理人未被冲掉');
      assert.equal(after!.latestAnnotation?.reason, oldReason, '原因未被冲掉');
    });

    it('重复导入（内容哈希相同）不破坏已有标注', () => {
      const before = m.findAnomalyById(protectedAnomalyId)!;
      const res = m.importSampleData();
      assert.equal(res.success, false, '重复导入应被拒绝');
      const after = m.findAnomalyById(protectedAnomalyId)!;
      assert.equal(after.latestAnnotation?.handler,
        before.latestAnnotation?.handler, '处理人不变');
      assert.equal(after.latestAnnotation?.reason,
        before.latestAnnotation?.reason, '原因不变');
    });
  });

  // ========= 5. 状态持久化（模拟跨重启） =========
  describe('5. 状态持久化（模拟跨重启）', () => {
    it('saveAppState / getAppState：selectedSensorId、statusFilter、timeRange 全部保留', () => {
      const sensors = m.findAllSensors();
      const pickId = sensors[sensors.length - 1].id;
      const original = m.getAppState();
      try {
        const saved = m.saveAppState({
          selectedSensorId: pickId,
          statusFilter: 'ACCEPTED',
          timeRange: '7D',
          customStart: undefined,
          customEnd: undefined,
          view: { scrollTop: 42 },
        });
        assert.equal(saved.selectedSensorId, pickId, 'selectedSensorId 保存正确');
        assert.equal(saved.statusFilter, 'ACCEPTED', 'statusFilter 保存正确');
        assert.equal(saved.timeRange, '7D', 'timeRange 保存正确');

        // 模拟重启：再次读取
        const restored = m.getAppState();
        assert.equal(restored.selectedSensorId, pickId, '重启后 selectedSensorId 恢复');
        assert.equal(restored.statusFilter, 'ACCEPTED', '重启后 statusFilter 恢复');
        assert.equal(restored.timeRange, '7D', '重启后 timeRange 恢复');
      } finally {
        // 还原
        m.saveAppState(original);
      }
    });

    it('重启后（持久化状态）导出：筛选条件与重启前一致', () => {
      const sensors = m.findAllSensors();
      const pickId = sensors[0].id;
      m.saveAppState({
        selectedSensorId: pickId,
        statusFilter: 'ACCEPTED',
        timeRange: 'ALL',
        customStart: undefined,
        customEnd: undefined,
        view: {},
      });

      // 第一次导出
      const csv1 = m.generateCsvReport({
        sensorId: pickId,
        statusFilter: 'ACCEPTED',
      });

      // "重启"：同进程不关闭 DB，但强制重新 getAppState
      const state = m.getAppState();
      assert.equal(state.selectedSensorId, pickId, '重启后状态恢复：传感器');
      assert.equal(state.statusFilter, 'ACCEPTED', '重启后状态恢复：状态筛选');

      // 第二次导出，用同样的持久化筛选
      const csv2 = m.generateCsvReport({
        sensorId: state.selectedSensorId!,
        statusFilter: state.statusFilter as any,
      });

      // 除了 BOM 和日期时间列，行数、主体内容应一致
      const normalize = (s: string) => s.replace(/\r/g, '').split('\n');
      const l1 = normalize(csv1);
      const l2 = normalize(csv2);
      assert.equal(l1.length, l2.length,
        `重启前后 CSV 行数应一致：${l1.length} vs ${l2.length}`);
    });
  });

  // ========= 6. 审计日志：所有关键操作可追溯 =========
  describe('6. 审计日志（冲突/操作追溯）', () => {
    it('关键操作写入 audit_logs：THRESHOLD_UPDATE、ANNOTATE_CREATE、ANNOTATE_ROLLBACK', () => {
      const logs = m.findRecentAuditLogs(100);
      const actions = new Set(logs.map((l) => l.action));
      assert.ok(actions.has('THRESHOLD_UPDATE'), '应有阈值更新日志');
      assert.ok(actions.has('ANNOTATE_CREATE'), '应有标注创建日志');
      assert.ok(actions.has('ANNOTATE_ROLLBACK'), '应有标注回滚日志');
      assert.ok(actions.has('IMPORT_BATCH'), '应有批量导入日志');
      assert.ok(actions.has('REPORT_EXPORT') || logs.length > 0, '至少有操作记录');
    });

    it('ANNOTATE_CREATE 日志包含 before/after，可用于冲突追溯', () => {
      const create = m.findRecentAuditLogs(50).filter((l) => l.action === 'ANNOTATE_CREATE');
      assert.ok(create.length > 0, '至少有一条标注创建日志');
      const last = create[0];
      assert.ok(last.entityId != null, 'entityId 存在');
      assert.ok(last.operator != null && last.operator.length > 0, 'operator 存在');
      assert.ok(last.after != null && typeof last.after === 'object', 'after 存在');
      assert.ok(
        (last.after as any).status
        || (last.after as any).handler,
        'after 中应含状态/处理人',
      );
    });
  });
});

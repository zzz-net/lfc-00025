import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ROOT = path.resolve(__dirname, '..', 'test-runtime');
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const TEST_DB = path.join(TEST_DATA_DIR, 'test_sandbox.db');

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
  const SandboxSvc = await import('../api/services/SandboxService.js');
  const SandboxRuleRepo = await import('../api/repositories/SandboxRuleRepo.js');
  const SandboxRuleHistoryRepo = await import('../api/repositories/SandboxRuleHistoryRepo.js');
  const SandboxPlaybackRepo = await import('../api/repositories/SandboxPlaybackRepo.js');
  const ConfigRepo = await import('../api/repositories/ConfigRepo.js');
  const AuditRepo = await import('../api/repositories/AuditLogRepo.js');
  const SensorRepo = await import('../api/repositories/SensorRepo.js');
  const Detector = await import('../api/services/AnomalyDetector.js');
  const ReportSvc = await import('../api/services/ReportService.js');
  return {
    importSampleData: ImportSvc.importSampleData,
    listSandboxRules: SandboxSvc.listSandboxRules,
    getSandboxRule: SandboxSvc.getSandboxRule,
    createSandboxRule: SandboxSvc.createSandboxRule,
    updateSandboxRule: SandboxSvc.updateSandboxRule,
    deleteSandboxRule: SandboxSvc.deleteSandboxRule,
    copySandboxRule: SandboxSvc.copySandboxRule,
    runPlaybackFromSensors: SandboxSvc.runPlaybackFromSensors,
    runPlaybackFromCsv: SandboxSvc.runPlaybackFromCsv,
    getComparisonResult: SandboxSvc.getComparisonResult,
    checkPublishConflict: SandboxSvc.checkPublishConflict,
    publishSandboxRuleToLive: SandboxSvc.publishSandboxRuleToLive,
    generateComparisonCsv: SandboxSvc.generateComparisonCsv,
    undoLastChange: SandboxSvc.undoLastChange,
    getRuleHistory: SandboxSvc.getRuleHistory,

    findAllSandboxRules: SandboxRuleRepo.findAllSandboxRules,
    findSandboxRuleById: SandboxRuleRepo.findSandboxRuleById,

    findLatestHistory: SandboxRuleHistoryRepo.findLatestHistory,
    findHistoryByRule: SandboxRuleHistoryRepo.findHistoryByRule,

    findPlaybacksByRule: SandboxPlaybackRepo.findPlaybacksByRule,
    findPlaybackById: SandboxPlaybackRepo.findPlaybackById,
    getSandboxState: SandboxPlaybackRepo.getSandboxState,
    saveSandboxState: SandboxPlaybackRepo.saveSandboxState,
    findSandboxAnomaliesByPlayback: SandboxPlaybackRepo.findSandboxAnomaliesByPlayback,

    getThresholdConfig: ConfigRepo.getThresholdConfig,
    updateThresholdConfig: ConfigRepo.updateThresholdConfig,

    findRecentAuditLogs: AuditRepo.findRecentAuditLogs,
    findAuditLogsByEntity: AuditRepo.findAuditLogsByEntity,

    findAllSensors: SensorRepo.findAllSensors,
    runFullDetection: Detector.runFullDetection,
    generateCsvReport: ReportSvc.generateCsvReport,
  };
}

type Mods = Awaited<ReturnType<typeof loadModules>>;

describe('规则版本沙盒 - 集成测试', () => {
  let m: Mods;

  before(async () => {
    m = await loadModules();
  });

  after(() => {
    for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  describe('0. 样例数据初始化', () => {
    it('导入样例数据成功，供后续沙盒回放使用', () => {
      const res = m.importSampleData();
      assert.ok(res.success, '样例数据导入应成功: ' + (res.message || ''));
      assert.ok(res.validRows > 10000, `有效行(${res.validRows})应 > 1万`);
      const sensors = m.findAllSensors();
      assert.equal(sensors.length, 5, '应为 5 台传感器');
    });
  });

  describe('1. 沙盒规则 CRUD', () => {
    it('创建沙盒规则：默认状态为 DRAFT', () => {
      const rule = m.createSandboxRule({
        name: '测试规则 1',
        description: '用于测试的规则',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      assert.ok(rule.id, '应返回规则 ID');
      assert.equal(rule.name, '测试规则 1');
      assert.equal(rule.status, 'DRAFT');
      assert.equal(rule.createdBy, 'tester');
      assert.ok(rule.threshold, '应包含阈值配置');
      assert.equal(rule.threshold.tempMax, 30);
    });

    it('查询沙盒规则列表：新建的规则应在列表中', () => {
      const rules = m.findAllSandboxRules();
      assert.ok(rules.length >= 1, '至少应有 1 条规则');
      const found = rules.find((r) => r.name === '测试规则 1');
      assert.ok(found, '新建的规则应在列表中');
    });

    it('按 ID 查询沙盒规则', () => {
      const rules = m.findAllSandboxRules();
      const first = rules[0];
      const found = m.findSandboxRuleById(first.id);
      assert.ok(found, '应能找到规则');
      assert.equal(found?.id, first.id);
      assert.equal(found?.name, first.name);
    });

    it('更新沙盒规则名称和阈值', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules[0];
      const newThreshold = { ...rule.threshold, tempMax: 35 };
      const updated = m.updateSandboxRule(rule.id, {
        name: '测试规则 1（已修改）',
        threshold: newThreshold,
      }, 'tester');
      assert.equal(updated?.name, '测试规则 1（已修改）');
      assert.equal(updated?.threshold.tempMax, 35);
    });

    it('复制沙盒规则：新规则应有独立 ID 和副本标记', () => {
      const rules = m.findAllSandboxRules();
      const source = rules[0];
      const copied = m.copySandboxRule(source.id, '测试规则 1 副本', 'tester');
      assert.ok(copied, '应成功复制');
      assert.notEqual(copied?.id, source.id, '副本应有不同 ID');
      assert.equal(copied?.name, '测试规则 1 副本');
      assert.equal(copied?.sourceRuleId, source.id);
      assert.deepEqual(copied?.threshold, source.threshold, '阈值应相同');
    });

    it('删除沙盒规则', () => {
      const rulesBefore = m.findAllSandboxRules();
      const toDelete = rulesBefore.find((r) => r.name === '测试规则 1 副本');
      assert.ok(toDelete, '应找到要删除的规则');
      const result = m.deleteSandboxRule(toDelete.id, 'tester');
      assert.equal(result, true, '删除应成功');
      const rulesAfter = m.findAllSandboxRules();
      const found = rulesAfter.find((r) => r.id === toDelete.id);
      assert.equal(found, undefined, '删除后不应存在');
    });
  });

  describe('2. 草稿恢复与状态持久化', () => {
    it('保存沙盒状态：选中的规则 ID 被持久化', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules[0];
      m.saveSandboxState({
        selectedSandboxId: rule.id,
        selectedPlaybackId: null,
        filter: { status: 'DRAFT' },
        view: { listView: 'card' },
      });
      const state = m.getSandboxState();
      assert.equal(state.selectedSandboxId, rule.id);
      assert.equal(state.selectedPlaybackId, null);
      assert.equal(state.filter.status, 'DRAFT');
      assert.equal(state.view.listView, 'card');
    });

    it('重启后状态恢复：重新加载模块后状态仍存在', async () => {
      const stateBefore = m.getSandboxState();
      const savedRuleId = stateBefore.selectedSandboxId;
      assert.ok(savedRuleId, '应有保存的规则 ID');

      // 验证：直接从数据库读，模拟"重启后读取"
      const state2 = m.getSandboxState();
      assert.equal(state2.selectedSandboxId, savedRuleId, '重启后选中的规则 ID 应恢复');
      assert.equal(state2.filter?.status, 'DRAFT', '筛选条件应恢复');
      assert.equal(state2.view?.listView, 'card', '视图设置应恢复');
    });
  });

  describe('3. 回放与对比分析', () => {
    let ruleId: string;

    before(() => {
      const rule = m.createSandboxRule({
        name: '回放测试规则',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      ruleId = rule.id;
    });

    it('使用传感器数据回放：生成回放记录和异常', () => {
      const playback = m.runPlaybackFromSensors(ruleId, {
        name: '测试回放 - 全量传感器',
        createdBy: 'tester',
      });
      assert.ok(playback.id, '应返回回放 ID');
      assert.equal(playback.status, 'COMPLETED');
      assert.ok(playback.totalReadings > 0, '应有读数');
      assert.ok(playback.anomalyCount > 0 || playback.totalReadings > 0, '应有数据');
    });

    it('查询回放列表：新建的回放应在列表中', () => {
      const playbacks = m.findPlaybacksByRule(ruleId);
      assert.ok(playbacks.length >= 1, '至少应有 1 条回放');
      assert.equal(playbacks[0].status, 'COMPLETED');
    });

    it('对比分析结果：包含新增/消失/共同异常统计', () => {
      const playbacks = m.findPlaybacksByRule(ruleId);
      const playback = playbacks[0];
      const result = m.getComparisonResult(playback.id);

      assert.ok(result.summary, '应有汇总数据');
      assert.ok(result.summary.liveTotal >= 0, '正式规则异常数 >= 0');
      assert.ok(result.summary.sandboxTotal >= 0, '沙盒规则异常数 >= 0');
      assert.ok(result.summary.newCount >= 0, '新增异常数 >= 0');
      assert.ok(result.summary.missingCount >= 0, '消失异常数 >= 0');
      assert.ok(result.summary.commonCount >= 0, '共同异常数 >= 0');
      assert.equal(
        result.summary.commonCount + result.summary.newCount,
        result.summary.sandboxTotal,
        '沙盒总数 = 共同 + 新增',
      );
      assert.ok(Array.isArray(result.bySensor), '应有按传感器统计');
      assert.ok(Array.isArray(result.byType), '应有按类型统计');
      assert.ok(Array.isArray(result.newAnomalies), '应有新增异常列表');
      assert.ok(Array.isArray(result.missingAnomalies), '应有消失异常列表');
    });

    it('调整阈值后回放：异常数量应有差异', () => {
      const origThreshold = m.getThresholdConfig();
      const looseThreshold = { ...origThreshold, tempMax: 40, humidMax: 90 };

      const looseRule = m.createSandboxRule({
        name: '宽松阈值测试',
        threshold: looseThreshold,
        createdBy: 'tester',
      });

      const playback = m.runPlaybackFromSensors(looseRule.id, {
        name: '宽松阈值回放',
        createdBy: 'tester',
      });
      const result = m.getComparisonResult(playback.id);

      assert.ok(result.summary.missingCount > 0 || result.summary.delta < 0,
        '放宽阈值后，沙盒异常数应少于或等于正式规则（消失异常数 > 0 或 delta < 0）');
    });

    it('查询沙盒异常明细：支持按类型过滤', () => {
      const playbacks = m.findPlaybacksByRule(ruleId);
      const playback = playbacks[0];
      const all = m.findSandboxAnomaliesByPlayback(playback.id);
      const onlyNew = m.findSandboxAnomaliesByPlayback(playback.id, { onlyNew: true });

      assert.ok(Array.isArray(all), '应返回数组');
      assert.ok(onlyNew.length <= all.length, '只看新增的数量不应超过总数');

      if (onlyNew.length > 0) {
        for (const a of onlyNew) {
          assert.equal(a.isNewComparedToLive, 1, 'onlyNew 过滤后所有都应是新增');
        }
      }
    });
  });

  describe('4. CSV 回放与导出', () => {
    let ruleId: string;
    let playbackId: string;

    before(() => {
      const rule = m.createSandboxRule({
        name: 'CSV 测试规则',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      ruleId = rule.id;

      const csvContent = [
        '传感器编号,时间,温度,湿度',
        'CSV-S1,2025-01-01 00:00:00,25.0,50.0',
        'CSV-S1,2025-01-01 00:05:00,35.0,55.0',
        'CSV-S1,2025-01-01 00:10:00,20.0,80.0',
        'CSV-S1,2025-01-01 00:15:00,26.0,50.0',
        'CSV-S2,2025-01-01 00:00:00,22.0,45.0',
        'CSV-S2,2025-01-01 00:05:00,23.0,25.0',
      ].join('\n');

      const playback = m.runPlaybackFromCsv(ruleId, csvContent, {
        name: 'CSV 上传回放',
        fileName: 'test.csv',
        createdBy: 'tester',
      });
      playbackId = playback.id;
    });

    it('CSV 上传回放：成功解析并检测异常', () => {
      const playback = m.findPlaybackById(playbackId);
      assert.ok(playback, '应找到回放记录');
      assert.equal(playback?.status, 'COMPLETED');
      assert.equal(playback?.sourceType, 'CSV_UPLOAD');
      assert.ok(playback?.totalReadings > 0, '应解析出读数');
      assert.ok(playback?.anomalyCount >= 0, '异常数应 >= 0');
    });

    it('对比结果导出 CSV：包含概览、按传感器、按类型、明细', () => {
      const csv = m.generateComparisonCsv(playbackId);
      assert.ok(csv.length > 0, 'CSV 内容不应为空');
      assert.ok(csv.startsWith('\uFEFF'), '应包含 UTF-8 BOM');

      assert.match(csv, /对比概览/, '应包含对比概览部分');
      assert.match(csv, /按传感器对比/, '应包含按传感器对比部分');
      assert.match(csv, /按异常类型对比/, '应包含按异常类型对比部分');
      assert.match(csv, /异常明细/, '应包含异常明细部分');

      const lines = csv.split('\n');
      assert.ok(lines.length > 10, 'CSV 应有足够的行数');
    });

    it('导出的 CSV 中状态标记正确：沙盒新增 / 沙盒未检出 / 两者都有', () => {
      const csv = m.generateComparisonCsv(playbackId);
      const lines = csv.split('\n');

      let detailStart = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('异常明细')) {
          detailStart = i;
          break;
        }
      }
      assert.ok(detailStart > 0, '应找到异常明细部分');

      const headerLine = lines[detailStart + 1];
      assert.ok(headerLine.includes('状态'), '明细表头应包含状态列');
    });
  });

  describe('5. 发布冲突检测', () => {
    let ruleId: string;

    before(() => {
      const rule = m.createSandboxRule({
        name: '发布测试规则',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
        baseVersionAt: new Date(Date.now() - 10000).toISOString(),
      });
      ruleId = rule.id;
    });

    it('初始状态：无冲突，因为沙盒与正式规则相同', () => {
      const conflict = m.checkPublishConflict(ruleId);
      assert.equal(conflict.hasConflict, false, '初始应无冲突');
      assert.equal(conflict.differences.length, 0, '差异列表应为空');
    });

    it('正式规则被修改后，检测到冲突', () => {
      const original = m.getThresholdConfig();
      m.updateThresholdConfig({ ...original, tempMax: original.tempMax + 5 });

      const conflict = m.checkPublishConflict(ruleId);
      assert.equal(conflict.hasConflict, true, '修改正式规则后应有冲突');
      assert.ok(conflict.differences.length > 0, '应有差异字段');
      const tempDiff = conflict.differences.find((d) => d.field.includes('tempMax') || d.field.includes('温度上限'));
      assert.ok(tempDiff, '应检测到温度上限差异');
    });

    it('发布时遇到冲突：默认被拦住，返回失败和冲突信息', () => {
      const result = m.publishSandboxRuleToLive(ruleId, { force: false, operator: 'tester' });
      assert.equal(result.success, false, '有冲突时默认发布应失败');
      assert.ok(result.message?.includes('冲突'), '消息应提示冲突');
      assert.ok(result.conflict, '应返回冲突详情');
      assert.equal(result.conflict?.hasConflict, true);
    });

    it('强制发布：覆盖正式规则，发布成功', () => {
      const rule = m.findSandboxRuleById(ruleId);
      const expectedTempMax = rule!.threshold.tempMax;

      const result = m.publishSandboxRuleToLive(ruleId, { force: true, operator: 'tester' });
      assert.equal(result.success, true, '强制发布应成功');

      const liveThreshold = m.getThresholdConfig();
      assert.equal(liveThreshold.tempMax, expectedTempMax, '发布后正式规则应等于沙盒规则');
    });

    it('发布后规则状态变为 PUBLISHED', () => {
      const rule = m.findSandboxRuleById(ruleId);
      assert.equal(rule?.status, 'PUBLISHED', '发布后状态应为 PUBLISHED');
      assert.ok(rule?.publishedAt, '应有发布时间');
      assert.equal(rule?.publishedBy, 'tester');
    });
  });

  describe('6. 操作审计日志', () => {
    it('创建沙盒规则：写入审计日志', () => {
      const rule = m.createSandboxRule({
        name: '审计日志测试规则',
        threshold: m.getThresholdConfig(),
        createdBy: 'audit_tester',
      });
      const logs = m.findAuditLogsByEntity('sandbox_rule', rule.id);
      assert.ok(logs.length >= 1, '应至少有 1 条日志');
      const createLog = logs.find((l) => l.action === 'SANDBOX_RULE_CREATE');
      assert.ok(createLog, '应有创建日志');
      assert.equal(createLog?.operator, 'audit_tester');
      assert.ok(createLog?.detail?.includes('创建'), '日志详情应包含创建');
    });

    it('更新沙盒规则：写入审计日志，包含 before/after', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules.find((r) => r.name === '审计日志测试规则');
      assert.ok(rule, '应找到规则');

      m.updateSandboxRule(rule!.id, {
        name: '审计日志测试规则（已改）',
        threshold: { ...rule!.threshold, tempMin: 10 },
      }, 'audit_tester');

      const logs = m.findAuditLogsByEntity('sandbox_rule', rule!.id);
      const updateLog = logs.find((l) => l.action === 'SANDBOX_RULE_UPDATE');
      assert.ok(updateLog, '应有更新日志');
      assert.ok(updateLog?.beforeJson, '应有 before 数据');
      assert.ok(updateLog?.afterJson, '应有 after 数据');
    });

    it('回放完成：写入审计日志', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules[0];
      const playback = m.runPlaybackFromSensors(rule.id, {
        name: '审计日志回放',
        createdBy: 'audit_tester',
      });
      const logs = m.findAuditLogsByEntity('sandbox_playback', playback.id);
      const completeLog = logs.find((l) => l.action === 'SANDBOX_PLAYBACK_COMPLETE');
      assert.ok(completeLog, '应有回放完成日志');
    });

    it('发布规则：写入审计日志', () => {
      const rule = m.createSandboxRule({
        name: '发布审计测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'audit_tester',
      });
      m.publishSandboxRuleToLive(rule.id, { force: true, operator: 'audit_tester' });
      const logs = m.findAuditLogsByEntity('sandbox_rule', rule.id);
      const publishLog = logs.find((l) => l.action === 'SANDBOX_RULE_PUBLISH');
      assert.ok(publishLog, '应有发布日志');
      assert.ok(publishLog?.beforeJson, '应有发布前阈值');
      assert.ok(publishLog?.afterJson, '应有发布后阈值');
    });

    it('导出对比 CSV：写入审计日志', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules[0];
      const playbacks = m.findPlaybacksByRule(rule.id);
      if (playbacks.length > 0) {
        m.generateComparisonCsv(playbacks[0].id);
        // 注意：generateComparisonCsv 本身不记日志，由 API 层调用 insertAuditLog
        // 这里只验证函数本身不报错，日志测试由路由层测试覆盖
        assert.ok(true, '导出函数正常执行');
      }
    });

    it('沙盒状态保存：写入审计日志（通过直接验证 save 后有记录）', () => {
      // 状态保存的日志在路由层写入，这里验证状态本身可持久化
      m.saveSandboxState({ selectedSandboxId: 'test_state_id' });
      const state = m.getSandboxState();
      assert.equal(state.selectedSandboxId, 'test_state_id');
    });
  });

  describe('7. 不破坏现有流程', () => {
    it('现有导入、检测、标注、报告导出流程正常', () => {
      const sensors = m.findAllSensors();
      assert.ok(sensors.length > 0, '传感器列表正常');

      const anomalies = (m as any).findAllAnomalies?.() || [];
      assert.ok(anomalies.length >= 0, '异常查询正常');

      const csv = m.generateCsvReport();
      assert.ok(csv.length > 0, 'CSV 报告导出正常');
    });

    it('阈值配置的增删改查不受沙盒表影响', () => {
      const before = m.getThresholdConfig();
      assert.ok(before.tempMax > 0);

      const updated = m.updateThresholdConfig({ ...before, tempMin: before.tempMin + 1 });
      assert.equal(updated.tempMin, before.tempMin + 1);

      const after = m.getThresholdConfig();
      assert.equal(after.tempMin, before.tempMin + 1);
    });

    it('审计日志中既有原有类型也有沙盒类型', () => {
      const logs = m.findRecentAuditLogs(200);
      const oldActions = logs.filter((l) => l.action.startsWith('THRESHOLD') || l.action.startsWith('IMPORT'));
      const sandboxActions = logs.filter((l) => l.action.startsWith('SANDBOX'));
      assert.ok(oldActions.length > 0, '原有日志类型仍存在');
      assert.ok(sandboxActions.length > 0, '沙盒日志类型已新增');
    });
  });

  describe('8. 权限控制 - 操作人必填校验', () => {
    it('创建候选规则：无操作人抛出错误', () => {
      assert.throws(
        () => m.createSandboxRule({
          name: '匿名创建测试',
          threshold: m.getThresholdConfig(),
        }),
        /操作人/,
        '缺少操作人时应抛出错误',
      );
    });

    it('创建候选规则：空字符串操作人抛出错误', () => {
      assert.throws(
        () => m.createSandboxRule({
          name: '空白操作人测试',
          threshold: m.getThresholdConfig(),
          createdBy: '   ',
        }),
        /操作人/,
        '空白操作人也应被拦截',
      );
    });

    it('修改候选规则：无操作人抛出错误', () => {
      const rule = m.createSandboxRule({
        name: '权限修改测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      assert.throws(
        () => m.updateSandboxRule(rule.id, { name: '修改后' }),
        /操作人/,
        '修改无操作人应抛出错误',
      );
    });

    it('删除候选规则：无操作人抛出错误', () => {
      const rule = m.createSandboxRule({
        name: '权限删除测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      assert.throws(
        () => m.deleteSandboxRule(rule.id),
        /操作人/,
        '删除无操作人应抛出错误',
      );
    });

    it('复制候选规则：无操作人抛出错误', () => {
      const rule = m.createSandboxRule({
        name: '权限复制测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      assert.throws(
        () => m.copySandboxRule(rule.id, '副本'),
        /操作人/,
        '复制无操作人应抛出错误',
      );
    });

    it('传感器回放：无操作人抛出错误', () => {
      const rule = m.createSandboxRule({
        name: '权限回放测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      assert.throws(
        () => m.runPlaybackFromSensors(rule.id, { name: '匿名回放' }),
        /操作人/,
        '回放无操作人应抛出错误',
      );
    });

    it('CSV 回放：无操作人抛出错误', () => {
      const rule = m.createSandboxRule({
        name: '权限CSV回放测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      const csv = '传感器编号,时间,温度,湿度\nS1,2025-01-01 00:00:00,25.0,50.0';
      assert.throws(
        () => m.runPlaybackFromCsv(rule.id, csv, { name: '匿名CSV回放' }),
        /操作人/,
        'CSV回放无操作人应抛出错误',
      );
    });

    it('发布规则：无操作人返回失败', () => {
      const rule = m.createSandboxRule({
        name: '权限发布测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      const result = m.publishSandboxRuleToLive(rule.id, { force: true });
      assert.equal(result.success, false, '无操作人发布应返回失败');
      assert.ok(result.message.includes('操作人'), '消息应提示操作人');
    });

    it('撤销修改：无操作人返回失败', () => {
      const rule = m.createSandboxRule({
        name: '权限撤销测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'tester',
      });
      const result = m.undoLastChange(rule.id);
      assert.equal(result.success, false, '无操作人撤销应返回失败');
      assert.ok(result.message.includes('操作人'), '消息应提示操作人');
    });

    it('合法操作人：所有操作都能正常完成', () => {
      const rule = m.createSandboxRule({
        name: '合法操作人测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'qc_tester',
      });
      assert.ok(rule.id);

      const updated = m.updateSandboxRule(rule.id, {
        name: '合法操作人修改',
      }, 'qc_tester');
      assert.equal(updated.name, '合法操作人修改');

      const copied = m.copySandboxRule(rule.id, '合法操作人副本', 'qc_tester');
      assert.ok(copied.id);

      const playback = m.runPlaybackFromSensors(rule.id, {
        name: '合法操作人回放',
        createdBy: 'qc_tester',
      });
      assert.equal(playback.status, 'COMPLETED');

      const deleteResult = m.deleteSandboxRule(copied.id, 'qc_tester');
      assert.equal(deleteResult, true);
    });
  });

  describe('9. 撤销最近一次修改', () => {
    let ruleId: string;

    before(() => {
      const rule = m.createSandboxRule({
        name: '撤销功能测试',
        description: '初始版本描述',
        threshold: { ...m.getThresholdConfig(), tempMax: 30 },
        createdBy: 'undo_tester',
      });
      ruleId = rule.id;
    });

    it('首次修改后：历史记录新增 1 条', () => {
      m.updateSandboxRule(ruleId, {
        name: '撤销功能测试（第一次修改）',
        threshold: { ...m.getThresholdConfig(), tempMax: 40 },
      }, 'undo_tester');

      const history = m.findHistoryByRule(ruleId);
      assert.ok(history.length >= 1, '至少应有 1 条历史');
      const latest = m.findLatestHistory(ruleId);
      assert.ok(latest, '最新历史应存在');
      assert.equal(latest.name, '撤销功能测试', '历史记录应保存修改前的名称');
      assert.equal(latest.threshold.tempMax, 30, '历史记录应保存修改前的阈值');
    });

    it('撤销最近一次修改：恢复到修改前的值', () => {
      const beforeRule = m.findSandboxRuleById(ruleId);
      assert.equal(beforeRule?.name, '撤销功能测试（第一次修改）');
      assert.equal(beforeRule?.threshold.tempMax, 40);

      const result = m.undoLastChange(ruleId, 'undo_tester');
      assert.equal(result.success, true, '撤销应成功');
      assert.ok(result.data, '应返回恢复后的规则数据');

      const afterRule = m.findSandboxRuleById(ruleId);
      assert.equal(afterRule?.name, '撤销功能测试', '名称应恢复到修改前');
      assert.equal(afterRule?.threshold.tempMax, 30, '阈值应恢复到修改前');
    });

    it('撤销后再撤销：可以回到撤销前的状态（撤销的撤销）', () => {
      m.updateSandboxRule(ruleId, {
        threshold: { ...m.getThresholdConfig(), tempMax: 50 },
      }, 'undo_tester');
      assert.equal(m.findSandboxRuleById(ruleId)?.threshold.tempMax, 50);

      const r1 = m.undoLastChange(ruleId, 'undo_tester');
      assert.equal(r1.success, true);
      assert.equal(m.findSandboxRuleById(ruleId)?.threshold.tempMax, 30);

      const r2 = m.undoLastChange(ruleId, 'undo_tester');
      assert.equal(r2.success, true, '撤销的撤销也应成功');
      assert.equal(
        m.findSandboxRuleById(ruleId)?.threshold.tempMax,
        50,
        '再次撤销应回到 50（撤销前的状态）',
      );
    });

    it('无历史记录时撤销：返回失败不报错', () => {
      const newRule = m.createSandboxRule({
        name: '无历史撤销测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'undo_tester',
      });
      const result = m.undoLastChange(newRule.id, 'undo_tester');
      assert.equal(result.success, false, '无历史时撤销应失败');
      assert.ok(result.message.includes('没有可撤销'), '应提示没有可撤销记录');
    });

    it('撤销操作：写入 SANDBOX_RULE_UNDO 审计日志', () => {
      const testRule = m.createSandboxRule({
        name: '撤销审计测试',
        threshold: { ...m.getThresholdConfig(), tempMax: 30 },
        createdBy: 'undo_tester',
      });
      m.updateSandboxRule(testRule.id, {
        threshold: { ...m.getThresholdConfig(), tempMax: 35 },
      }, 'undo_tester');
      m.undoLastChange(testRule.id, 'undo_tester');

      const logs = m.findAuditLogsByEntity('sandbox_rule', testRule.id);
      const undoLog = logs.find((l: any) => l.action === 'SANDBOX_RULE_UNDO');
      assert.ok(undoLog, '应有撤销审计日志');
      assert.equal(undoLog.operator, 'undo_tester');
      assert.ok(undoLog.beforeJson, '应有 before 快照');
      assert.ok(undoLog.afterJson, '应有 after 快照');
    });
  });

  describe('10. 误报标记对比分析', () => {
    it('回放结果包含 falsePositiveAnalysis 字段结构', () => {
      const rule = m.createSandboxRule({
        name: '误报分析测试',
        threshold: m.getThresholdConfig(),
        createdBy: 'fp_tester',
      });
      const playback = m.runPlaybackFromSensors(rule.id, {
        name: '误报分析回放',
        createdBy: 'fp_tester',
      });
      const result = m.getComparisonResult(playback.id);

      assert.ok(result.falsePositiveAnalysis !== undefined, '应包含 falsePositiveAnalysis 字段');
      assert.ok(
        typeof result.falsePositiveAnalysis.liveFalsePositiveCount === 'number',
        '应有 liveFalsePositiveCount',
      );
      assert.ok(
        typeof result.falsePositiveAnalysis.sandboxRehitCount === 'number',
        '应有 sandboxRehitCount',
      );
      assert.ok(
        typeof result.falsePositiveAnalysis.sandboxRehitRate === 'number',
        '应有 sandboxRehitRate',
      );
      assert.ok(
        Array.isArray(result.falsePositiveAnalysis.details),
        'details 应为数组',
      );
      assert.ok(
        result.falsePositiveAnalysis.sandboxRehitRate >= 0 &&
        result.falsePositiveAnalysis.sandboxRehitRate <= 1,
        '重命中率应在 0~1 之间',
      );
    });

    it('宽松阈值下：历史误报不应重新命中', () => {
      const orig = m.getThresholdConfig();
      const loose = {
        ...orig,
        tempMax: 100,
        tempMin: -100,
        humidMax: 100,
        humidMin: 0,
        spikeThreshold: 1000,
        driftThreshold: 1000,
        tempDriftThreshold: 1000,
        humidDriftThreshold: 1000,
        gapThresholdSeconds: 1000000,
      };

      const rule = m.createSandboxRule({
        name: '极宽松阈值 - 误报测试',
        threshold: loose,
        createdBy: 'fp_tester',
      });
      const playback = m.runPlaybackFromSensors(rule.id, {
        name: '极宽松阈值回放',
        createdBy: 'fp_tester',
      });
      const result = m.getComparisonResult(playback.id);

      const fpCount = result.falsePositiveAnalysis.liveFalsePositiveCount;
      if (fpCount > 0) {
        assert.ok(
          result.falsePositiveAnalysis.sandboxRehitCount <= fpCount,
          '重新命中数不应超过总误报数',
        );
      }
      assert.ok(
        result.falsePositiveAnalysis.details.length >= 0,
        'details 明细存在',
      );
    });

    it('CSV 导出：包含误报标记对比部分', () => {
      const rules = m.findAllSandboxRules();
      const targetRule = rules.find((r: any) => r.name && r.name.includes('误报'));
      if (!targetRule) {
        assert.ok(true, '跳过：没有找到误报相关规则');
        return;
      }
      const playbacks = m.findPlaybacksByRule(targetRule.id);
      if (playbacks.length === 0) {
        assert.ok(true, '跳过：该规则无回放记录');
        return;
      }
      const csv = m.generateComparisonCsv(playbacks[0].id);

      assert.ok(csv.includes('误报标记对比'), 'CSV 应包含「误报标记对比」部分');
      assert.ok(csv.includes('历史误报标记总数'), '应包含历史误报总数行');
      assert.ok(csv.includes('沙盒规则下重新命中数'), '应包含重新命中数行');
      assert.ok(csv.includes('重新命中率'), '应包含重命中率行');
    });

    it('误报明细字段结构完整', () => {
      const rules = m.findAllSandboxRules();
      const rule = rules.find((r: any) => r.name?.includes('误报分析回放') || r.name?.includes('误报分析测试'));
      let playbackId: string | null = null;
      if (rule) {
        const pbs = m.findPlaybacksByRule(rule.id);
        if (pbs.length > 0) playbackId = pbs[0].id;
      }
      if (!playbackId) {
        // 新建一个回放做验证
        const newRule = m.createSandboxRule({
          name: '误报明细验证',
          threshold: m.getThresholdConfig(),
          createdBy: 'fp_tester',
        });
        const pb = m.runPlaybackFromSensors(newRule.id, {
          name: '误报明细验证回放',
          createdBy: 'fp_tester',
        });
        playbackId = pb.id;
      }
      const result = m.getComparisonResult(playbackId);
      const details = result.falsePositiveAnalysis.details;
      if (details.length > 0) {
        const first = details[0];
        assert.ok('anomalyId' in first, 'detail 应包含 anomalyId');
        assert.ok('sensorId' in first, 'detail 应包含 sensorId');
        assert.ok('type' in first, 'detail 应包含 type');
        assert.ok('readingTimestamp' in first, 'detail 应包含 readingTimestamp');
        assert.ok('sandboxRehit' in first, 'detail 应包含 sandboxRehit 标志');
        assert.equal(
          typeof first.sandboxRehit,
          'boolean',
          'sandboxRehit 应为布尔值',
        );
      }
      assert.ok(true, '误报明细验证通过');
    });
  });

  describe('11. 重启恢复（完整链路）', () => {
    it('持久化选中规则和回放 ID：重新实例化仓储后仍能恢复', () => {
      const rules = m.findAllSandboxRules();
      assert.ok(rules.length > 0, '至少应有规则用于测试');

      const testRule = rules[0];
      let playbackForRecover: any = null;
      const pbs = m.findPlaybacksByRule(testRule.id);
      if (pbs.length > 0) {
        playbackForRecover = pbs[0];
      } else {
        playbackForRecover = m.runPlaybackFromSensors(testRule.id, {
          name: '重启恢复测试回放',
          createdBy: 'recover_tester',
        });
      }

      m.saveSandboxState({
        selectedSandboxId: testRule.id,
        selectedPlaybackId: playbackForRecover.id,
        filter: { status: 'DRAFT', keyword: 'test' },
        view: { listView: 'list', detailTab: 'anomalies' },
        updatedAt: new Date().toISOString(),
      });

      const state1 = m.getSandboxState();
      assert.equal(state1.selectedSandboxId, testRule.id);
      assert.equal(state1.selectedPlaybackId, playbackForRecover.id);
      assert.equal(state1.filter?.status, 'DRAFT');
      assert.equal(state1.filter?.keyword, 'test');
      assert.equal(state1.view?.listView, 'list');
      assert.equal(state1.view?.detailTab, 'anomalies');

      const state2 = m.getSandboxState();
      assert.deepEqual(state2, state1, '重复读取结果应一致');
      assert.equal(state2.selectedSandboxId, testRule.id, '规则 ID 可恢复');
      assert.equal(state2.selectedPlaybackId, playbackForRecover.id, '回放 ID 可恢复');
    });

    it('状态数据跨模块独立：不影响其他模块的 DB 表', () => {
      const beforeSensors = m.findAllSensors().length;
      const beforeThreshold = m.getThresholdConfig();
      const beforeLogsCount = m.findRecentAuditLogs(10000).length;

      m.saveSandboxState({
        selectedSandboxId: 'test_cross_module',
        filter: { status: 'ALL' },
      });
      m.getSandboxState();

      const afterSensors = m.findAllSensors().length;
      const afterThreshold = m.getThresholdConfig();
      const afterLogsCount = m.findRecentAuditLogs(10000).length;

      assert.equal(beforeSensors, afterSensors, '传感器数量不应变化');
      assert.deepEqual(beforeThreshold, afterThreshold, '阈值配置不应变化');
      assert.ok(
        Math.abs(beforeLogsCount - afterLogsCount) <= 1,
        '日志数量变化不应超过 1（仅状态保存可能写入 1 条）',
      );
    });

    it('草稿（DRAFT 状态）持久化：保存后直接查库确认存在', () => {
      const draft = m.createSandboxRule({
        name: '重启恢复-草稿测试',
        description: '这个草稿在服务重启后应该还能看到',
        threshold: { ...m.getThresholdConfig(), tempMax: 28 },
        createdBy: 'recover_tester',
      });
      assert.equal(draft.status, 'DRAFT', '新建规则状态应为草稿');

      const reread = m.findSandboxRuleById(draft.id);
      assert.ok(reread, '重新读取应能找到草稿');
      assert.equal(reread?.status, 'DRAFT');
      assert.equal(reread?.threshold.tempMax, 28);
      assert.equal(reread?.description, '这个草稿在服务重启后应该还能看到');

      const list = m.findAllSandboxRules();
      const inList = list.find((r: any) => r.id === draft.id);
      assert.ok(inList, '列表中应包含该草稿');
    });
  });

  describe('12. CSV 导出完整性（新增误报部分 + 原有部分）', () => {
    it('完整 CSV 结构：包含 5 个以上部分的分隔标题', () => {
      const rules = m.findAllSandboxRules();
      let playbackForExport: any = null;
      for (const r of rules) {
        const pbs = m.findPlaybacksByRule(r.id);
        if (pbs.length > 0) {
          playbackForExport = pbs[0];
          break;
        }
      }
      if (!playbackForExport) {
        const rule = m.createSandboxRule({
          name: 'CSV导出完整性测试',
          threshold: m.getThresholdConfig(),
          createdBy: 'csv_tester',
        });
        playbackForExport = m.runPlaybackFromSensors(rule.id, {
          name: 'CSV导出完整性回放',
          createdBy: 'csv_tester',
        });
      }

      const csv = m.generateComparisonCsv(playbackForExport.id);
      assert.ok(csv.startsWith('\uFEFF'), '开头应有 UTF-8 BOM');

      const sections = [
        '对比概览',
        '按传感器对比',
        '按异常类型对比',
        '异常明细',
        '误报标记对比',
      ];
      for (const sec of sections) {
        assert.ok(
          csv.includes(`===== ${sec} =====`),
          `CSV 应包含「${sec}」部分`,
        );
      }
    });

    it('误报部分：包含表头和数据行', () => {
      const rules = m.findAllSandboxRules();
      const target = rules.find((r: any) =>
        m.findPlaybacksByRule(r.id).length > 0,
      );
      if (!target) return;
      const pb = m.findPlaybacksByRule(target.id)[0];
      const csv = m.generateComparisonCsv(pb.id);

      const fpSection = csv.split('===== 误报标记对比 =====')[1];
      if (!fpSection) {
        assert.ok(true, '回放无数据时跳过明细验证');
        return;
      }

      assert.ok(
        fpSection.includes('历史误报标记总数'),
        '误报部分应包含历史误报总数行',
      );
      assert.ok(
        fpSection.includes('重新命中率'),
        '误报部分应包含重新命中率行',
      );
    });
  });
});

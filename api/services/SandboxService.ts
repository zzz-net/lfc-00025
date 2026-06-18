import { detectFromReadings } from './AnomalyDetector.js';
import { findReadingsBySensor } from '../repositories/ReadingRepo.js';
import { findAllSensors, findSensorById } from '../repositories/SensorRepo.js';
import { getThresholdConfig, updateThresholdConfig } from '../repositories/ConfigRepo.js';
import { findAllUnprotectedBySensor } from '../repositories/AnomalyRepo.js';
import {
  createPlayback, updatePlaybackStatus, insertSandboxAnomalies,
  findSandboxAnomaliesByPlayback, countSandboxAnomaliesByPlayback,
  findPlaybackById,
} from '../repositories/SandboxPlaybackRepo.js';
import {
  findSandboxRuleById, findAllSandboxRules, createSandboxRule as createSandboxRuleRepo,
  updateSandboxRule as updateSandboxRuleRepo, deleteSandboxRule as deleteSandboxRuleRepo,
  copySandboxRule as copySandboxRuleRepo, publishSandboxRule,
} from '../repositories/SandboxRuleRepo.js';
import {
  findLatestHistory, findHistoryByRule, insertRuleHistory,
} from '../repositories/SandboxRuleHistoryRepo.js';
import { insertAuditLog } from '../repositories/AuditLogRepo.js';
import { parseCsvContent } from '../utils/csvParser.js';
import { generateId } from '../utils/fileHash.js';
import { db } from '../data/db.js';
import type {
  ThresholdConfig, SandboxPlayback, SandboxAnomaly, SandboxComparisonResult,
  PublishConflictInfo, AnomalyType, SandboxRuleHistory, SandboxRuleStatus,
} from '../../shared/types.js';

export function runPlaybackFromSensors(
  ruleId: string,
  options: {
    name?: string;
    sensorIds?: string[];
    timeStart?: string;
    timeEnd?: string;
    createdBy?: string;
  } = {},
): SandboxPlayback {
  if (!options.createdBy || typeof options.createdBy !== 'string' || !options.createdBy.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许发起回放');
  }
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const playbackName = options.name || `回放 - ${new Date().toLocaleString('zh-CN')}`;
  const op = options.createdBy.trim();
  const playback = createPlayback({
    sandboxRuleId: ruleId,
    name: playbackName,
    sourceType: 'SENSOR_RANGE',
    sensorIds: options.sensorIds,
    timeStart: options.timeStart,
    timeEnd: options.timeEnd,
    createdBy: op,
    sourceMeta: {
      sensorIds: options.sensorIds,
      timeStart: options.timeStart,
      timeEnd: options.timeEnd,
    },
  });

  updatePlaybackStatus(playback.id, 'RUNNING');

  try {
    const sensorIds = options.sensorIds || findAllSensors().map((s) => s.id);
    const allReadings: Array<{
      sensorId: string; timestamp: string; temperature: number; humidity: number; readingId: string;
    }> = [];

    for (const sid of sensorIds) {
      const readings = findReadingsBySensor(sid, options.timeStart, options.timeEnd);
      for (const r of readings) {
        allReadings.push({
          sensorId: sid,
          timestamp: r.timestamp,
          temperature: r.temperature,
          humidity: r.humidity,
          readingId: r.id,
        });
      }
    }

    _runDetectionAndCompare(playback.id, ruleId, rule.threshold, allReadings, sensorIds);

    const finalPlayback = updatePlaybackStatus(playback.id, 'COMPLETED', {
      totalReadings: allReadings.length,
      completedAt: new Date().toISOString(),
    });

    insertAuditLog({
      action: 'SANDBOX_PLAYBACK_COMPLETE',
      entityType: 'sandbox_playback',
      entityId: playback.id,
      operator: op,
      after: { ruleName: rule.name, playbackName, readingCount: allReadings.length },
      detail: `沙盒回放完成：${rule.name} - ${playbackName}`,
    });

    return finalPlayback!;
  } catch (e: any) {
    updatePlaybackStatus(playback.id, 'FAILED', {
      errorMessage: e.message || String(e),
    });
    throw e;
  }
}

export function runPlaybackFromCsv(
  ruleId: string,
  csvContent: string,
  options: {
    name?: string;
    createdBy?: string;
    fileName?: string;
  } = {},
): SandboxPlayback {
  if (!options.createdBy || typeof options.createdBy !== 'string' || !options.createdBy.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许发起 CSV 回放');
  }
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const playbackName = options.name || `CSV回放 - ${options.fileName || new Date().toLocaleString('zh-CN')}`;
  const op = options.createdBy.trim();

  const batchId = generateId('tmp_');
  const parseResult = parseCsvContent(csvContent, batchId);

  const playback = createPlayback({
    sandboxRuleId: ruleId,
    name: playbackName,
    sourceType: 'CSV_UPLOAD',
    sensorIds: parseResult.sensors.map((s) => s.id),
    createdBy: op,
    sourceMeta: {
      fileName: options.fileName,
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      errorCount: parseResult.errors.length,
    },
  });

  updatePlaybackStatus(playback.id, 'RUNNING');

  try {
    const allReadings = parseResult.readings.map((r) => ({
      sensorId: r.sensorId,
      timestamp: r.timestamp,
      temperature: r.temperature,
      humidity: r.humidity,
      readingId: r.id,
    }));
    const sensorIds = parseResult.sensors.map((s) => s.id);

    _runDetectionAndCompare(playback.id, ruleId, rule.threshold, allReadings, sensorIds);

    const finalPlayback = updatePlaybackStatus(playback.id, 'COMPLETED', {
      totalReadings: allReadings.length,
      completedAt: new Date().toISOString(),
      result: { parseErrors: parseResult.errors },
    });

    insertAuditLog({
      action: 'SANDBOX_PLAYBACK_COMPLETE',
      entityType: 'sandbox_playback',
      entityId: playback.id,
      operator: op,
      after: { ruleName: rule.name, playbackName, readingCount: allReadings.length, fileName: options.fileName },
      detail: `CSV沙盒回放完成：${rule.name} - ${playbackName}`,
    });

    return finalPlayback!;
  } catch (e: any) {
    updatePlaybackStatus(playback.id, 'FAILED', {
      errorMessage: e.message || String(e),
    });
    throw e;
  }
}

function _runDetectionAndCompare(
  playbackId: string,
  ruleId: string,
  threshold: ThresholdConfig,
  readings: Array<{ sensorId: string; timestamp: string; temperature: number; humidity: number; readingId: string }>,
  sensorIds: string[],
): void {
  const liveThreshold = getThresholdConfig();
  const liveAnomaliesBySensor: Record<string, Set<string>> = {};

  for (const sid of sensorIds) {
    const liveAnoms = findAllUnprotectedBySensor(sid);
    liveAnomaliesBySensor[sid] = new Set(liveAnoms.map((a) => `${a.type}:${a.readingId}`));
  }

  const sandboxAnomalies: Array<{
    sensorId: string;
    readingId?: string;
    type: AnomalyType;
    description: string;
    readingTimestamp: string;
    temperature?: number;
    humidity?: number;
    isNewComparedToLive: number;
    isMissingComparedToLive: number;
  }> = [];

  for (const sid of sensorIds) {
    const sensorReadings = readings.filter((r) => r.sensorId === sid);
    const detected = detectFromReadings(
      sensorReadings.map((r) => ({
        id: r.readingId,
        sensorId: r.sensorId,
        timestamp: r.timestamp,
        temperature: r.temperature,
        humidity: r.humidity,
        batchId: '',
      })),
      threshold,
    );

    const sandboxKeys = new Set<string>();
    const readingMap = new Map(sensorReadings.map((r) => [r.readingId, r]));

    for (const d of detected) {
      const key = `${d.type}:${d.readingId}`;
      sandboxKeys.add(key);
      const reading = readingMap.get(d.readingId);

      const isNew = liveAnomaliesBySensor[sid]
        ? !liveAnomaliesBySensor[sid].has(key)
        : true;

      sandboxAnomalies.push({
        sensorId: sid,
        readingId: d.readingId,
        type: d.type,
        description: d.description,
        readingTimestamp: reading?.timestamp || '',
        temperature: reading?.temperature,
        humidity: reading?.humidity,
        isNewComparedToLive: isNew ? 1 : 0,
        isMissingComparedToLive: 0,
      });
    }

    for (const liveKey of (liveAnomaliesBySensor[sid] || [])) {
      if (!sandboxKeys.has(liveKey)) {
        const [type, readingId] = liveKey.split(':');
        const liveAnom = (findAllUnprotectedBySensor(sid)).find(
          (a) => a.type === type && a.readingId === readingId,
        );
        if (liveAnom && liveAnom.reading) {
          sandboxAnomalies.push({
            sensorId: sid,
            readingId,
            type: type as AnomalyType,
            description: `正式规则存在，沙盒规则未检出：${liveAnom.description}`,
            readingTimestamp: liveAnom.reading.timestamp,
            temperature: liveAnom.reading.temperature,
            humidity: liveAnom.reading.humidity,
            isNewComparedToLive: 0,
            isMissingComparedToLive: 1,
          });
        }
      }
    }
  }

  const count = insertSandboxAnomalies(playbackId, ruleId, sandboxAnomalies);
    updatePlaybackStatus(playbackId, 'RUNNING', { anomalyCount: count });

    const fpAnalysis = _analyzeFalsePositives(sensorIds, ruleId, threshold, readings);
    const currentPb = findPlaybackById(playbackId);
    const existingResult = currentPb?.result || {};
    updatePlaybackStatus(playbackId, 'RUNNING', {
      result: { ...existingResult, falsePositiveAnalysis: fpAnalysis },
    });
  }

export function getComparisonResult(playbackId: string): SandboxComparisonResult {
  const anomalies = findSandboxAnomaliesByPlayback(playbackId);
  const stats = countSandboxAnomaliesByPlayback(playbackId);
  const allSensors = findAllSensors();
  const sensorMap = new Map(allSensors.map((s) => [s.id, s]));
  const playbackInfo = findPlaybackById(playbackId);

  const newAnomalies = anomalies.filter((a) => a.isNewComparedToLive === 1);
  const missingAnomalies = anomalies.filter((a) => a.isMissingComparedToLive === 1);
  const commonCount = stats.total - stats.newCount - stats.missingCount;

  const bySensorMap: Record<string, { liveCount: number; sandboxCount: number; newCount: number; missingCount: number }> = {};
  for (const a of anomalies) {
    if (!bySensorMap[a.sensorId]) {
      bySensorMap[a.sensorId] = { liveCount: 0, sandboxCount: 0, newCount: 0, missingCount: 0 };
    }
    if (a.isNewComparedToLive) {
      bySensorMap[a.sensorId].sandboxCount++;
      bySensorMap[a.sensorId].newCount++;
    } else if (a.isMissingComparedToLive) {
      bySensorMap[a.sensorId].liveCount++;
      bySensorMap[a.sensorId].missingCount++;
    } else {
      bySensorMap[a.sensorId].liveCount++;
      bySensorMap[a.sensorId].sandboxCount++;
    }
  }

  const bySensor = Object.entries(bySensorMap).map(([sensorId, s]) => ({
    sensorId,
    sensorName: sensorMap.get(sensorId)?.name || sensorId,
    liveCount: s.liveCount,
    sandboxCount: s.sandboxCount,
    newCount: s.newCount,
    missingCount: s.missingCount,
    delta: s.sandboxCount - s.liveCount,
  }));
  bySensor.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const byTypeMap: Record<string, { liveCount: number; sandboxCount: number; newCount: number; missingCount: number }> = {};
  for (const a of anomalies) {
    if (!byTypeMap[a.type]) {
      byTypeMap[a.type] = { liveCount: 0, sandboxCount: 0, newCount: 0, missingCount: 0 };
    }
    if (a.isNewComparedToLive) {
      byTypeMap[a.type].sandboxCount++;
      byTypeMap[a.type].newCount++;
    } else if (a.isMissingComparedToLive) {
      byTypeMap[a.type].liveCount++;
      byTypeMap[a.type].missingCount++;
    } else {
      byTypeMap[a.type].liveCount++;
      byTypeMap[a.type].sandboxCount++;
    }
  }

  const byType = Object.entries(byTypeMap).map(([type, t]) => ({
    type,
    liveCount: t.liveCount,
    sandboxCount: t.sandboxCount,
    newCount: t.newCount,
    missingCount: t.missingCount,
    delta: t.sandboxCount - t.liveCount,
  }));
  byType.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const liveTotal = stats.total - stats.newCount;
  const sandboxTotal = stats.total - stats.missingCount;

  return {
    summary: {
      liveTotal,
      sandboxTotal,
      newCount: stats.newCount,
      missingCount: stats.missingCount,
      commonCount,
      delta: sandboxTotal - liveTotal,
    },
    bySensor,
    byType,
    newAnomalies: newAnomalies.slice(0, 100),
    missingAnomalies: missingAnomalies.slice(0, 100),
    falsePositiveAnalysis: playbackInfo?.result?.falsePositiveAnalysis,
  };
}

export function checkPublishConflict(ruleId: string): PublishConflictInfo {
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const liveThreshold = getThresholdConfig();
  const thresholdRow: any = db.prepare('SELECT updated_at FROM threshold_config WHERE id = 1').get();
  const lastLiveUpdateAt = thresholdRow?.updated_at || '';

  const differences: { field: string; liveValue: number; sandboxValue: number }[] = [];

  const fieldMap: Array<[string, keyof ThresholdConfig]> = [
    ['温度下限 tempMin', 'tempMin'],
    ['温度上限 tempMax', 'tempMax'],
    ['湿度下限 humidMin', 'humidMin'],
    ['湿度上限 humidMax', 'humidMax'],
    ['温度漂移 tempDriftThreshold', 'tempDriftThreshold'],
    ['湿度漂移 humidDriftThreshold', 'humidDriftThreshold'],
    ['断点时间 gapThresholdSeconds', 'gapThresholdSeconds'],
  ];

  for (const [label, key] of fieldMap) {
    const liveVal = liveThreshold[key];
    const sbVal = rule.threshold[key];
    if (liveVal !== sbVal) {
      differences.push({ field: label, liveValue: liveVal, sandboxValue: sbVal });
    }
  }

  let hasConflict: boolean;
  if (rule.baseVersionAt) {
    const baseTime = new Date(rule.baseVersionAt).getTime();
    const liveTimeStr = lastLiveUpdateAt?.replace(' ', 'T') + 'Z';
    const liveUpdateTime = new Date(liveTimeStr).getTime();
    hasConflict = liveUpdateTime > baseTime && differences.length > 0;
  } else {
    hasConflict = differences.length > 0;
  }

  return {
    hasConflict,
    liveThreshold,
    sandboxThreshold: rule.threshold,
    lastLiveUpdateAt,
    sandboxBaseVersionAt: rule.baseVersionAt,
    differences,
  };
}

export function publishSandboxRuleToLive(
  ruleId: string,
  options: { force?: boolean; operator?: string } = {},
): { success: boolean; message: string; conflict?: PublishConflictInfo } {
  if (!options.operator || typeof options.operator !== 'string' || !options.operator.trim()) {
    return {
      success: false,
      message: '缺少操作人标识，匿名请求不允许发布候选规则',
    };
  }
  const op = options.operator.trim();
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const conflict = checkPublishConflict(ruleId);
  if (conflict.hasConflict && !options.force) {
    return {
      success: false,
      message: '发布冲突：正式规则已被修改，请确认差异后再发布',
      conflict,
    };
  }

  const beforeThreshold = getThresholdConfig();
  updateThresholdConfig(rule.threshold);

  publishSandboxRule(ruleId, op);

  updateSandboxRule(ruleId, {
    status: 'PUBLISHED',
    publishedAt: new Date().toISOString(),
    publishedBy: op,
  }, op);

  insertAuditLog({
    action: 'SANDBOX_RULE_PUBLISH',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: op,
    before: beforeThreshold,
    after: rule.threshold,
    detail: `沙盒规则「${rule.name}」已发布为正式阈值${conflict.hasConflict ? '（强制发布，已覆盖冲突）' : ''}`,
  });

  return { success: true, message: '发布成功，正式阈值已更新' };
}

export function generateComparisonCsv(playbackId: string): string {
  const result = getComparisonResult(playbackId);
  const allAnomalies = findSandboxAnomaliesByPlayback(playbackId);
  const sensors = findAllSensors();
  const sensorMap = new Map(sensors.map((s) => [s.id, s.name]));

  const lines: string[] = [];

  lines.push('===== 对比概览 =====');
  lines.push('指标,正式规则,沙盒规则,差异');
  lines.push(`异常总数,${result.summary.liveTotal},${result.summary.sandboxTotal},${result.summary.delta >= 0 ? '+' : ''}${result.summary.delta}`);
  lines.push(`新增异常（沙盒特有）,,-,${result.summary.newCount}`);
  lines.push(`消失异常（正式有，沙盒无）,${result.summary.missingCount},,-`);
  lines.push(`共同异常,${result.summary.commonCount},${result.summary.commonCount},-`);
  lines.push('');

  lines.push('===== 按传感器对比 =====');
  lines.push('传感器ID,传感器名称,正式规则异常数,沙盒规则异常数,新增数,消失数,差异');
  for (const s of result.bySensor) {
    lines.push(`${s.sensorId},${s.sensorName},${s.liveCount},${s.sandboxCount},${s.newCount},${s.missingCount},${s.delta >= 0 ? '+' : ''}${s.delta}`);
  }
  lines.push('');

  lines.push('===== 按异常类型对比 =====');
  lines.push('异常类型,正式规则数,沙盒规则数,新增数,消失数,差异');
  for (const t of result.byType) {
    lines.push(`${t.type},${t.liveCount},${t.sandboxCount},${t.newCount},${t.missingCount},${t.delta >= 0 ? '+' : ''}${t.delta}`);
  }
  lines.push('');

  lines.push('===== 异常明细 =====');
  lines.push('ID,传感器ID,传感器名称,类型,描述,读数时间,温度,湿度,状态');
  for (const a of allAnomalies) {
    const status = a.isNewComparedToLive
      ? '沙盒新增'
      : a.isMissingComparedToLive
        ? '沙盒未检出'
        : '两者都有';
    lines.push([
      a.id,
      a.sensorId,
      sensorMap.get(a.sensorId) || a.sensorId,
      a.type,
      `"${a.description.replace(/"/g, '""')}"`,
      a.readingTimestamp,
      a.temperature ?? '',
      a.humidity ?? '',
      status,
    ].join(','));
  }

  if (result.falsePositiveAnalysis) {
    lines.push('');
    lines.push('===== 误报标记对比 =====');
    lines.push(`历史误报标记总数,${result.falsePositiveAnalysis.liveFalsePositiveCount}`);
    lines.push(`沙盒规则下重新命中数,${result.falsePositiveAnalysis.sandboxRehitCount}`);
    lines.push(`重新命中率（%）,${(result.falsePositiveAnalysis.sandboxRehitRate * 100).toFixed(2)}`);
    lines.push('');
    lines.push('误报明细,异常ID,传感器ID,类型,原异常描述,时间,标注原因,沙盒是否重新命中');
    for (const fp of result.falsePositiveAnalysis.details) {
      lines.push([
        '',
        fp.anomalyId,
        fp.sensorId,
        fp.type,
        `"${fp.description.replace(/"/g, '""')}"`,
        fp.readingTimestamp,
        `"${fp.annotationReason.replace(/"/g, '""')}"`,
        fp.sandboxRehit ? '是' : '否',
      ].join(','));
    }
  }

  return '\uFEFF' + lines.join('\n');
}

export function listSandboxRules() {
  return findAllSandboxRules();
}

export function getSandboxRule(ruleId: string) {
  return findSandboxRuleById(ruleId);
}

export function createSandboxRule(data: {
  name: string;
  description?: string;
  threshold: ThresholdConfig;
  createdBy?: string;
  baseVersionAt?: string;
}) {
  if (!data.createdBy || typeof data.createdBy !== 'string' || !data.createdBy.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许创建候选规则');
  }
  let baseVersionAt = data.baseVersionAt;
  if (!baseVersionAt) {
    const row: any = db.prepare('SELECT updated_at FROM threshold_config WHERE id = 1').get();
    baseVersionAt = row?.updated_at || new Date().toISOString();
  }

  const rule = createSandboxRuleRepo({
    name: data.name,
    description: data.description,
    threshold: data.threshold,
    createdBy: data.createdBy.trim(),
    baseVersionAt,
  });

  insertAuditLog({
    action: 'SANDBOX_RULE_CREATE',
    entityType: 'sandbox_rule',
    entityId: rule.id,
    operator: data.createdBy.trim(),
    after: { name: rule.name, threshold: rule.threshold },
    detail: `创建沙盒规则「${rule.name}」`,
  });

  return rule;
}

export function updateSandboxRule(ruleId: string, data: {
  name?: string;
  description?: string;
  threshold?: ThresholdConfig;
  status?: SandboxRuleStatus;
  publishedAt?: string;
  publishedBy?: string;
}, operator?: string) {
  if (!operator || typeof operator !== 'string' || !operator.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许修改候选规则');
  }
  const before = findSandboxRuleById(ruleId);
  if (!before) throw new Error('沙盒规则不存在');

  const rule = updateSandboxRuleRepo(ruleId, { ...data, changedBy: operator.trim() });

  insertAuditLog({
    action: 'SANDBOX_RULE_UPDATE',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: operator.trim(),
    before: { name: before.name, threshold: before.threshold },
    after: { name: rule.name, threshold: rule.threshold },
    detail: `更新沙盒规则「${rule.name}」`,
  });

  return rule;
}

export function deleteSandboxRule(ruleId: string, operator?: string) {
  if (!operator || typeof operator !== 'string' || !operator.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许删除候选规则');
  }
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  deleteSandboxRuleRepo(ruleId);

  insertAuditLog({
    action: 'SANDBOX_RULE_DELETE',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: operator.trim(),
    before: { name: rule.name },
    detail: `删除沙盒规则「${rule.name}」`,
  });

  return true;
}

export function copySandboxRule(sourceId: string, newName: string, operator?: string) {
  if (!operator || typeof operator !== 'string' || !operator.trim()) {
    throw new Error('缺少操作人标识，匿名请求不允许复制候选规则');
  }
  const source = findSandboxRuleById(sourceId);
  if (!source) throw new Error('沙盒规则不存在');

  const newRule = copySandboxRuleRepo(sourceId, newName, operator.trim());

  insertAuditLog({
    action: 'SANDBOX_RULE_COPY',
    entityType: 'sandbox_rule',
    entityId: newRule.id,
    operator: operator.trim(),
    after: { name: newRule.name, sourceRuleId: sourceId },
    detail: `复制沙盒规则「${source.name}」为「${newRule.name}」`,
  });

  return newRule;
}

export function getRuleHistory(ruleId: string, limit = 20): SandboxRuleHistory[] {
  return findHistoryByRule(ruleId, limit);
}

export function undoLastChange(ruleId: string, operator?: string): {
  success: boolean;
  message: string;
  data?: any;
} {
  if (!operator || typeof operator !== 'string' || !operator.trim()) {
    return {
      success: false,
      message: '缺少操作人标识，匿名请求不允许撤销修改',
    };
  }
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const latest = findLatestHistory(ruleId);
  if (!latest) {
    return {
      success: false,
      message: '没有可撤销的修改记录',
    };
  }

  const op = operator || 'system';
  insertRuleHistory({
    sandboxRuleId: ruleId,
    name: rule.name,
    description: rule.description,
    threshold: rule.threshold,
    changedBy: op,
    changeReason: '撤销前快照',
  });

  const updated = updateSandboxRuleRepo(ruleId, {
    name: latest.name,
    description: latest.description,
    threshold: latest.threshold,
    changedBy: op,
    skipHistory: true,
  });

  insertAuditLog({
    action: 'SANDBOX_RULE_UNDO',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: op,
    before: { name: rule.name, threshold: rule.threshold },
    after: { name: latest.name, threshold: latest.threshold },
    detail: `撤销规则「${rule.name}」的最近一次修改，恢复到「${latest.name}」版本`,
  });

  return {
    success: true,
    message: '已撤销最近一次修改',
    data: updated,
  };
}

function _analyzeFalsePositives(
  sensorIds: string[],
  ruleId: string,
  sandboxThreshold: ThresholdConfig,
  allReadings: Array<{ sensorId: string; timestamp: string; temperature: number; humidity: number; readingId: string }>,
) {
  const fpRows: any[] = db.prepare(`
    SELECT a.id as anomaly_id, a.type, a.sensor_id, a.reading_id, a.description,
           r.timestamp, r.temperature, r.humidity,
           an.status, an.handler, an.reason
    FROM anomalies a
    JOIN readings r ON a.reading_id = r.id
    JOIN annotations an ON an.anomaly_id = a.id
    WHERE an.status = 'FALSE_POSITIVE'
      AND an.rolled_back_at IS NULL
  `).all();

  if (fpRows.length === 0) {
    return {
      liveFalsePositiveCount: 0,
      sandboxRehitCount: 0,
      sandboxRehitRate: 0,
      details: [],
    };
  }

  const readingMap = new Map(
    allReadings.map((r) => [`${r.sensorId}:${r.timestamp}`, r]),
  );
  const sensorReadingGroups: Record<string, typeof allReadings> = {};
  for (const r of allReadings) {
    if (!sensorReadingGroups[r.sensorId]) sensorReadingGroups[r.sensorId] = [];
    sensorReadingGroups[r.sensorId].push(r);
  }

  const sandboxKeysBySensor: Record<string, Set<string>> = {};
  for (const sid of Object.keys(sensorReadingGroups)) {
    const detected = detectFromReadings(
      sensorReadingGroups[sid].map((r) => ({
        id: r.readingId,
        sensorId: r.sensorId,
        timestamp: r.timestamp,
        temperature: r.temperature,
        humidity: r.humidity,
        batchId: '',
      })),
      sandboxThreshold,
    );
    sandboxKeysBySensor[sid] = new Set(
      detected.map((d) => `${d.type}:${d.readingId}`),
    );
  }

  const details = fpRows.map((fp) => {
    const key = `${fp.type}:${fp.reading_id}`;
    const sensorKeys = sandboxKeysBySensor[fp.sensor_id];
    const rehit = sensorKeys ? sensorKeys.has(key) : false;
    return {
      anomalyId: fp.anomaly_id,
      type: fp.type as AnomalyType,
      sensorId: fp.sensor_id,
      description: fp.description || '',
      readingTimestamp: fp.timestamp,
      annotationReason: fp.reason || '',
      sandboxRehit: rehit,
    };
  });

  const rehitCount = details.filter((d) => d.sandboxRehit).length;

  return {
    liveFalsePositiveCount: fpRows.length,
    sandboxRehitCount: rehitCount,
    sandboxRehitRate: fpRows.length > 0 ? rehitCount / fpRows.length : 0,
    details: details.slice(0, 100),
  };
}

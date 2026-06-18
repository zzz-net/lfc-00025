import { detectFromReadings } from './AnomalyDetector.js';
import { findReadingsBySensor } from '../repositories/ReadingRepo.js';
import { findAllSensors, findSensorById } from '../repositories/SensorRepo.js';
import { getThresholdConfig, updateThresholdConfig } from '../repositories/ConfigRepo.js';
import { findAllUnprotectedBySensor } from '../repositories/AnomalyRepo.js';
import {
  createPlayback, updatePlaybackStatus, insertSandboxAnomalies,
  findSandboxAnomaliesByPlayback, countSandboxAnomaliesByPlayback,
} from '../repositories/SandboxPlaybackRepo.js';
import {
  findSandboxRuleById, findAllSandboxRules, createSandboxRule as createSandboxRuleRepo,
  updateSandboxRule as updateSandboxRuleRepo, deleteSandboxRule as deleteSandboxRuleRepo,
  copySandboxRule as copySandboxRuleRepo, publishSandboxRule,
} from '../repositories/SandboxRuleRepo.js';
import { insertAuditLog } from '../repositories/AuditLogRepo.js';
import { parseCsvContent } from '../utils/csvParser.js';
import { generateId } from '../utils/fileHash.js';
import { db } from '../data/db.js';
import type {
  ThresholdConfig, SandboxPlayback, SandboxAnomaly, SandboxComparisonResult,
  PublishConflictInfo, AnomalyType,
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
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const playbackName = options.name || `回放 - ${new Date().toLocaleString('zh-CN')}`;
  const playback = createPlayback({
    sandboxRuleId: ruleId,
    name: playbackName,
    sourceType: 'SENSOR_RANGE',
    sensorIds: options.sensorIds,
    timeStart: options.timeStart,
    timeEnd: options.timeEnd,
    createdBy: options.createdBy,
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
      operator: options.createdBy || 'system',
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
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  const playbackName = options.name || `CSV回放 - ${options.fileName || new Date().toLocaleString('zh-CN')}`;

  const batchId = generateId('tmp_');
  const parseResult = parseCsvContent(csvContent, batchId);

  const playback = createPlayback({
    sandboxRuleId: ruleId,
    name: playbackName,
    sourceType: 'CSV_UPLOAD',
    sensorIds: parseResult.sensors.map((s) => s.id),
    createdBy: options.createdBy,
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
      operator: options.createdBy || 'system',
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
}

export function getComparisonResult(playbackId: string): SandboxComparisonResult {
  const playback = findSandboxAnomaliesByPlayback(playbackId);
  const stats = countSandboxAnomaliesByPlayback(playbackId);
  const allSensors = findAllSensors();
  const sensorMap = new Map(allSensors.map((s) => [s.id, s]));

  const newAnomalies = playback.filter((a) => a.isNewComparedToLive === 1);
  const missingAnomalies = playback.filter((a) => a.isMissingComparedToLive === 1);
  const commonCount = stats.total - stats.newCount - stats.missingCount;

  const bySensorMap: Record<string, { liveCount: number; sandboxCount: number; newCount: number; missingCount: number }> = {};
  for (const a of playback) {
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
  for (const a of playback) {
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

  publishSandboxRule(ruleId, options.operator);

  updateSandboxRule(ruleId, {
    status: 'PUBLISHED',
    publishedAt: new Date().toISOString(),
    publishedBy: options.operator || 'system',
  });

  insertAuditLog({
    action: 'SANDBOX_RULE_PUBLISH',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: options.operator || 'system',
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
  let baseVersionAt = data.baseVersionAt;
  if (!baseVersionAt) {
    const row: any = db.prepare('SELECT updated_at FROM threshold_config WHERE id = 1').get();
    baseVersionAt = row?.updated_at || new Date().toISOString();
  }

  const rule = createSandboxRuleRepo({
    name: data.name,
    description: data.description,
    threshold: data.threshold,
    status: 'DRAFT',
    createdBy: data.createdBy || 'system',
    baseVersionAt,
  });

  insertAuditLog({
    action: 'SANDBOX_RULE_CREATE',
    entityType: 'sandbox_rule',
    entityId: rule.id,
    operator: data.createdBy || 'system',
    after: { name: rule.name, threshold: rule.threshold },
    detail: `创建沙盒规则「${rule.name}」`,
  });

  return rule;
}

export function updateSandboxRule(ruleId: string, data: {
  name?: string;
  threshold?: ThresholdConfig;
  status?: string;
}, operator?: string) {
  const before = findSandboxRuleById(ruleId);
  if (!before) throw new Error('沙盒规则不存在');

  const rule = updateSandboxRuleRepo(ruleId, data);

  insertAuditLog({
    action: 'SANDBOX_RULE_UPDATE',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: operator || 'system',
    before: { name: before.name, threshold: before.threshold },
    after: { name: rule.name, threshold: rule.threshold },
    detail: `更新沙盒规则「${rule.name}」`,
  });

  return rule;
}

export function deleteSandboxRule(ruleId: string, operator?: string) {
  const rule = findSandboxRuleById(ruleId);
  if (!rule) throw new Error('沙盒规则不存在');

  deleteSandboxRuleRepo(ruleId);

  insertAuditLog({
    action: 'SANDBOX_RULE_DELETE',
    entityType: 'sandbox_rule',
    entityId: ruleId,
    operator: operator || 'system',
    before: { name: rule.name },
    detail: `删除沙盒规则「${rule.name}」`,
  });

  return true;
}

export function copySandboxRule(sourceId: string, newName: string, operator?: string) {
  const source = findSandboxRuleById(sourceId);
  if (!source) throw new Error('沙盒规则不存在');

  const newRule = copySandboxRuleRepo(sourceId, newName, operator || source.createdBy);

  insertAuditLog({
    action: 'SANDBOX_RULE_COPY',
    entityType: 'sandbox_rule',
    entityId: newRule.id,
    operator: operator || 'system',
    after: { name: newRule.name, sourceRuleId: sourceId },
    detail: `复制沙盒规则「${source.name}」为「${newRule.name}」`,
  });

  return newRule;
}

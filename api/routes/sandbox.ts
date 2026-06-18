import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  findAllSandboxRules, findSandboxRuleById, createSandboxRule,
  updateSandboxRule, deleteSandboxRule, copySandboxRule,
} from '../repositories/SandboxRuleRepo.js';
import {
  findPlaybacksByRule, findPlaybackById, findSandboxAnomaliesByPlayback,
  getSandboxState, saveSandboxState, deletePlayback,
} from '../repositories/SandboxPlaybackRepo.js';
import {
  runPlaybackFromSensors, runPlaybackFromCsv, getComparisonResult,
  checkPublishConflict, publishSandboxRuleToLive, generateComparisonCsv,
} from '../services/SandboxService.js';
import { getThresholdConfig } from '../repositories/ConfigRepo.js';
import { insertAuditLog } from '../repositories/AuditLogRepo.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/rules', (_req: Request, res: Response) => {
  const rules = findAllSandboxRules();
  res.json({ success: true, data: rules });
});

router.get('/rules/:id', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }
  res.json({ success: true, data: rule });
});

router.post('/rules', (req: Request, res: Response) => {
  const { name, description, threshold, copyFromLive, operator } = req.body;

  let thresholdToUse = threshold;
  if (copyFromLive || !thresholdToUse) {
    thresholdToUse = getThresholdConfig();
  }

  const rule = createSandboxRule({
    name: name || '新规则草稿',
    description,
    threshold: thresholdToUse,
    createdBy: operator || 'system',
    baseVersionAt: new Date().toISOString(),
  });

  insertAuditLog({
    action: 'SANDBOX_RULE_CREATE',
    entityType: 'sandbox_rule',
    entityId: rule.id,
    operator: operator || 'system',
    after: { name: rule.name, threshold: rule.threshold },
    detail: `创建沙盒规则：${rule.name}`,
  });

  res.json({ success: true, data: rule });
});

router.put('/rules/:id', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }

  const { name, description, threshold, operator } = req.body;
  const before = { name: rule.name, description: rule.description, threshold: rule.threshold };

  const updated = updateSandboxRule(req.params.id, {
    name,
    description,
    threshold,
  });

  if (updated) {
    insertAuditLog({
      action: 'SANDBOX_RULE_UPDATE',
      entityType: 'sandbox_rule',
      entityId: rule.id,
      operator: operator || 'system',
      before,
      after: { name: updated.name, description: updated.description, threshold: updated.threshold },
      detail: `更新沙盒规则：${updated.name}`,
    });
  }

  res.json({ success: true, data: updated });
});

router.delete('/rules/:id', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }

  const { operator } = req.query as { operator?: string };
  const deleted = deleteSandboxRule(req.params.id);

  if (deleted) {
    insertAuditLog({
      action: 'SANDBOX_RULE_DELETE',
      entityType: 'sandbox_rule',
      entityId: rule.id,
      operator: operator || 'system',
      before: { name: rule.name },
      detail: `删除沙盒规则：${rule.name}`,
    });
  }

  res.json({ success: deleted });
});

router.post('/rules/:id/copy', (req: Request, res: Response) => {
  const source = findSandboxRuleById(req.params.id);
  if (!source) {
    res.status(404).json({ success: false, error: '源规则不存在' });
    return;
  }

  const { newName, operator } = req.body;
  const name = newName || `${source.name} 副本`;

  const copied = copySandboxRule(req.params.id, name, operator);

  if (copied) {
    insertAuditLog({
      action: 'SANDBOX_RULE_COPY',
      entityType: 'sandbox_rule',
      entityId: copied.id,
      operator: operator || 'system',
      before: { sourceId: source.id, sourceName: source.name },
      after: { name: copied.name },
      detail: `复制沙盒规则：${source.name} → ${copied.name}`,
    });
  }

  res.json({ success: !!copied, data: copied });
});

router.get('/rules/:id/playbacks', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }
  const playbacks = findPlaybacksByRule(req.params.id);
  res.json({ success: true, data: playbacks });
});

router.post('/rules/:id/playback/sensors', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }

  const { name, sensorIds, timeStart, timeEnd, operator } = req.body;

  const playback = runPlaybackFromSensors(req.params.id, {
    name,
    sensorIds,
    timeStart,
    timeEnd,
    createdBy: operator,
  });

  insertAuditLog({
    action: 'SANDBOX_PLAYBACK_CREATE',
    entityType: 'sandbox_playback',
    entityId: playback.id,
    operator: operator || 'system',
    after: { name: playback.name, ruleId: req.params.id, sourceType: 'SENSOR_RANGE' },
    detail: `创建回放任务：${playback.name}`,
  });

  res.json({ success: true, data: playback });
});

router.post('/rules/:id/playback/csv', upload.single('file'), (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ success: false, error: '请上传 CSV 文件' });
    return;
  }

  const content = req.file.buffer.toString('utf-8');
  const { name, operator } = req.body;

  const playback = runPlaybackFromCsv(req.params.id, content, {
    name: name || req.file.originalname,
    fileName: req.file.originalname,
    createdBy: operator,
  });

  insertAuditLog({
    action: 'SANDBOX_PLAYBACK_CREATE',
    entityType: 'sandbox_playback',
    entityId: playback.id,
    operator: operator || 'system',
    after: { name: playback.name, ruleId: req.params.id, sourceType: 'CSV_UPLOAD', fileName: req.file.originalname },
    detail: `创建CSV回放任务：${playback.name}`,
  });

  res.json({ success: true, data: playback });
});

router.get('/playbacks/:id', (req: Request, res: Response) => {
  const playback = findPlaybackById(req.params.id);
  if (!playback) {
    res.status(404).json({ success: false, error: '回放任务不存在' });
    return;
  }
  res.json({ success: true, data: playback });
});

router.get('/playbacks/:id/comparison', (req: Request, res: Response) => {
  const playback = findPlaybackById(req.params.id);
  if (!playback) {
    res.status(404).json({ success: false, error: '回放任务不存在' });
    return;
  }
  const result = getComparisonResult(req.params.id);
  res.json({ success: true, data: result });
});

router.get('/playbacks/:id/anomalies', (req: Request, res: Response) => {
  const { sensorId, type, onlyNew, onlyMissing, limit } = req.query as {
    sensorId?: string; type?: string; onlyNew?: string; onlyMissing?: string; limit?: string;
  };
  const anomalies = findSandboxAnomaliesByPlayback(req.params.id, {
    sensorId,
    type,
    onlyNew: onlyNew === 'true',
    onlyMissing: onlyMissing === 'true',
    limit: limit ? parseInt(limit, 10) : undefined,
  });
  res.json({ success: true, data: anomalies });
});

router.get('/playbacks/:id/export', (req: Request, res: Response) => {
  const playback = findPlaybackById(req.params.id);
  if (!playback) {
    res.status(404).json({ success: false, error: '回放任务不存在' });
    return;
  }

  const csv = generateComparisonCsv(req.params.id);
  const fileName = `sandbox_comparison_${playback.id}.csv`;

  insertAuditLog({
    action: 'SANDBOX_EXPORT_CSV',
    entityType: 'sandbox_playback',
    entityId: playback.id,
    operator: (req.query.operator as string) || 'system',
    after: { fileName, playbackName: playback.name },
    detail: `导出沙盒对比报告：${playback.name}`,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(csv);
});

router.delete('/playbacks/:id', (req: Request, res: Response) => {
  const playback = findPlaybackById(req.params.id);
  if (!playback) {
    res.status(404).json({ success: false, error: '回放任务不存在' });
    return;
  }

  const { operator } = req.query as { operator?: string };
  const deleted = deletePlayback(req.params.id);

  if (deleted) {
    insertAuditLog({
      action: 'SANDBOX_PLAYBACK_DELETE',
      entityType: 'sandbox_playback',
      entityId: req.params.id,
      operator: operator || 'system',
      before: { name: playback.name },
      detail: `删除回放任务：${playback.name}`,
    });
  }

  res.json({ success: deleted });
});

router.get('/rules/:id/conflict', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }
  const conflict = checkPublishConflict(req.params.id);
  res.json({ success: true, data: conflict });
});

router.post('/rules/:id/publish', (req: Request, res: Response) => {
  const rule = findSandboxRuleById(req.params.id);
  if (!rule) {
    res.status(404).json({ success: false, error: '沙盒规则不存在' });
    return;
  }

  const { force, operator } = req.body;
  const result = publishSandboxRuleToLive(req.params.id, { force, operator });

  if (!result.success && result.conflict) {
    res.status(409).json(result);
    return;
  }

  res.json(result);
});

router.get('/state', (_req: Request, res: Response) => {
  const state = getSandboxState();
  res.json({ success: true, data: state });
});

router.post('/state', (req: Request, res: Response) => {
  const { filter, view, selectedSandboxId, selectedPlaybackId, operator } = req.body;
  saveSandboxState({ filter, view, selectedSandboxId, selectedPlaybackId });

  insertAuditLog({
    action: 'SANDBOX_STATE_SAVE',
    entityType: 'sandbox_state',
    operator: operator || 'system',
    after: { selectedSandboxId, selectedPlaybackId },
    detail: '保存沙盒页面状态',
  });

  const state = getSandboxState();
  res.json({ success: true, data: state });
});

export default router;

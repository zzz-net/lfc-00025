import { Router, type Request, type Response } from 'express';
import {
  findAllAnomalies,
  findAnomalyById,
} from '../repositories/AnomalyRepo.js';
import {
  insertAnnotation,
} from '../repositories/AnnotationRepo.js';
import { runFullDetection } from '../services/AnomalyDetector.js';
import { getThresholdConfig, updateThresholdConfig } from '../repositories/ConfigRepo.js';
import { generateId } from '../utils/fileHash.js';
import type { AnnotationStatus, ThresholdConfig } from '../../shared/types.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { sensorId, status } = req.query as { sensorId?: string; status?: string };
  const anomalies = findAllAnomalies(sensorId, status as any);
  res.json({ success: true, data: anomalies });
});

router.get('/thresholds', (req: Request, res: Response) => {
  const config = getThresholdConfig();
  res.json({ success: true, data: config });
});

router.post('/detect', (req: Request, res: Response) => {
  const stats = runFullDetection();
  res.json({ success: true, data: stats });
});

router.put('/thresholds', (req: Request, res: Response) => {
  const body = req.body as Partial<ThresholdConfig>;
  const current = getThresholdConfig();
  const merged: ThresholdConfig = { ...current, ...body };
  const valid =
    typeof merged.tempMin === 'number' &&
    typeof merged.tempMax === 'number' &&
    typeof merged.humidMin === 'number' &&
    typeof merged.humidMax === 'number' &&
    typeof merged.tempDriftThreshold === 'number' &&
    typeof merged.humidDriftThreshold === 'number' &&
    typeof merged.gapThresholdSeconds === 'number' &&
    merged.tempMin < merged.tempMax &&
    merged.humidMin < merged.humidMax &&
    merged.tempDriftThreshold >= 0 &&
    merged.humidDriftThreshold >= 0 &&
    merged.gapThresholdSeconds >= 1;
  if (!valid) {
    res.status(400).json({ success: false, error: '阈值配置不合法' });
    return;
  }
  const updated = updateThresholdConfig(merged);
  const stats = runFullDetection(updated, { beforeThreshold: current });
  res.json({ success: true, data: { threshold: updated, detectionStats: stats } });
});

router.get('/:id', (req: Request, res: Response) => {
  const anomaly = findAnomalyById(req.params.id);
  if (!anomaly) {
    res.status(404).json({ success: false, error: '异常记录不存在' });
    return;
  }
  res.json({ success: true, data: anomaly });
});

router.post('/:id/annotate', (req: Request, res: Response) => {
  const anomaly = findAnomalyById(req.params.id);
  if (!anomaly) {
    res.status(404).json({ success: false, error: '异常记录不存在' });
    return;
  }
  const { status, handler, reason } = req.body as {
    status: AnnotationStatus;
    handler: string;
    reason: string;
  };
  if (!status || !handler || handler.trim() === '' || !reason || reason.trim() === '') {
    res.status(400).json({ success: false, error: '状态、处理人和原因不能为空' });
    return;
  }
  const validStatuses: AnnotationStatus[] = ['PENDING', 'ACCEPTED', 'FALSE_POSITIVE', 'RETEST'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: '无效的状态值' });
    return;
  }
  const ann = insertAnnotation({
    id: generateId('ann_'),
    anomalyId: anomaly.id,
    status,
    handler: handler.trim(),
    reason: reason.trim(),
  });
  res.json({ success: true, data: ann });
});

export default router;

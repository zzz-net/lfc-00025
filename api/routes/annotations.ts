import { Router, type Request, type Response } from 'express';
import {
  findAnnotationHistory,
  findLatestAnnotation,
  rollbackLatestAnnotation,
  insertAnnotation,
} from '../repositories/AnnotationRepo.js';
import { findAnomalyById } from '../repositories/AnomalyRepo.js';
import { generateId } from '../utils/fileHash.js';
import type { AnnotationStatus } from '../../shared/types.js';

const router = Router();

const VALID_STATUSES: AnnotationStatus[] = ['PENDING', 'ACCEPTED', 'FALSE_POSITIVE', 'RETEST'];

router.post('/', (req: Request, res: Response) => {
  const { anomalyId, status, handler, reason } = req.body as {
    anomalyId?: string;
    status?: AnnotationStatus;
    handler?: string;
    reason?: string;
  };

  if (!anomalyId || !status || !handler || !reason) {
    res.status(400).json({ success: false, error: '缺少必要参数: anomalyId, status, handler, reason' });
    return;
  }

  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ success: false, error: `无效状态: ${status}，有效值: ${VALID_STATUSES.join(', ')}` });
    return;
  }

  if (handler.trim().length === 0) {
    res.status(400).json({ success: false, error: '处理人不能为空' });
    return;
  }

  if (reason.trim().length === 0) {
    res.status(400).json({ success: false, error: '处理原因不能为空' });
    return;
  }

  const anomaly = findAnomalyById(anomalyId);
  if (!anomaly) {
    res.status(404).json({ success: false, error: `异常不存在: ${anomalyId}` });
    return;
  }

  const annotation = insertAnnotation({
    id: generateId('n_'),
    anomalyId,
    status,
    handler: handler.trim(),
    reason: reason.trim(),
  });

  res.json({ success: true, data: annotation });
});

router.get('/history', (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 100;
  const history = findAnnotationHistory(limit);
  res.json({ success: true, data: history });
});

router.get('/latest', (req: Request, res: Response) => {
  const latest = findLatestAnnotation();
  res.json({ success: true, data: latest });
});

router.post('/rollback', (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  const latest = findLatestAnnotation();
  if (!latest) {
    res.status(404).json({ success: false, error: '没有可回滚的标注' });
    return;
  }
  const result = rollbackLatestAnnotation(reason || '回滚最近一次标注');
  res.json({ success: true, data: result });
});

export default router;

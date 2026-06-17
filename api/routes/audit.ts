import { Router, type Request, type Response } from 'express';
import {
  findRecentAuditLogs,
  findAuditLogsByEntity,
} from '../repositories/AuditLogRepo.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 200;
  const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };
  let logs;
  if (entityType) {
    logs = findAuditLogsByEntity(entityType, entityId, limit);
  } else {
    logs = findRecentAuditLogs(limit);
  }
  res.json({ success: true, data: logs });
});

export default router;

import { Router, type Request, type Response } from 'express';
import { getAppState, saveAppState } from '../repositories/ConfigRepo.js';
import type { AppState } from '../../shared/types.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const state = getAppState();
  res.json({ success: true, data: state });
});

router.put('/', (req: Request, res: Response) => {
  const body = req.body as Partial<AppState>;
  const current = getAppState();
  const merged: AppState = { ...current, ...body, view: { ...current.view, ...(body.view || {}) } };
  const saved = saveAppState(merged);
  res.json({ success: true, data: saved });
});

export default router;

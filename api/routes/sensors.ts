import { Router, type Request, type Response } from 'express';
import { findAllSensors, findSensorById } from '../repositories/SensorRepo.js';
import { findReadingsBySensor } from '../repositories/ReadingRepo.js';
import { findAllAnomalies } from '../repositories/AnomalyRepo.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const sensors = findAllSensors();
  res.json({ success: true, data: sensors });
});

router.get('/:id', (req: Request, res: Response) => {
  const sensor = findSensorById(req.params.id);
  if (!sensor) {
    res.status(404).json({ success: false, error: '传感器不存在' });
    return;
  }
  res.json({ success: true, data: sensor });
});

router.get('/:id/readings', (req: Request, res: Response) => {
  const { id } = req.params;
  const { start, end } = req.query as { start?: string; end?: string };
  const readings = findReadingsBySensor(id, start, end);
  res.json({ success: true, data: readings });
});

router.get('/:id/anomalies', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.query as { status?: string };
  const anomalies = findAllAnomalies(id, status as any);
  res.json({ success: true, data: anomalies });
});

export default router;

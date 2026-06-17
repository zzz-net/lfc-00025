import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { importContent, importSampleData, verifyContent } from '../services/ImportService.js';
import { findAllBatches } from '../repositories/BatchRepo.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/sample', (req: Request, res: Response) => {
  const result = importSampleData();
  const statusCode = result.success ? 200 : 409;
  res.status(statusCode).json({ ...result });
});

router.post('/verify', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: '没有上传文件' });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const isJson = ext === '.json' || (file.mimetype && file.mimetype.includes('json'));
  const content = file.buffer.toString('utf-8');
  const result = verifyContent(file.originalname, content, isJson);
  res.json({ success: true, ...result });
});

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: '没有上传文件' });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const isJson = ext === '.json' || (file.mimetype && file.mimetype.includes('json'));
  const content = file.buffer.toString('utf-8');
  const result = importContent(file.originalname, content, isJson);
  const statusCode = result.success ? 200 : 409;
  res.status(statusCode).json({ ...result });
});

router.get('/batches', (req: Request, res: Response) => {
  const batches = findAllBatches();
  res.json({ success: true, data: batches });
});

export default router;

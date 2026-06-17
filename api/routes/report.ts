import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateCsvReport, generatePdfReport } from '../services/ReportService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORT_DIR = path.resolve(__dirname, '..', '..', 'exports');

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const router = Router();

router.post('/csv', (req: Request, res: Response) => {
  const csv = generateCsvReport();
  const fileName = `qc_report_${Date.now()}.csv`;
  const filePath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf-8');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send('\uFEFF' + csv);
});

router.post('/pdf', (req: Request, res: Response) => {
  const buf = generatePdfReport();
  const fileName = `qc_report_${Date.now()}.pdf`;
  const filePath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(buf));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(buf));
});

router.get('/list', (req: Request, res: Response) => {
  if (!fs.existsSync(EXPORT_DIR)) {
    res.json({ success: true, data: [] });
    return;
  }
  const files = fs.readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith('.csv') || f.endsWith('.pdf'))
    .map((f) => {
      const stat = fs.statSync(path.join(EXPORT_DIR, f));
      return { name: f, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ success: true, data: files });
});

export default router;

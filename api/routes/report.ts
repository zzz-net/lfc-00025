import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateCsvReport, generatePdfReport, type ReportFilter } from '../services/ReportService.js';
import { getAppState } from '../repositories/ConfigRepo.js';
import { insertAuditLog } from '../repositories/AuditLogRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORT_DIR = path.resolve(__dirname, '..', '..', 'exports');

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function resolveTimeRange(appState: any, customStart?: string, customEnd?: string): { start?: string; end?: string } {
  const tr = appState.timeRange || 'ALL';
  if (tr === 'CUSTOM') {
    return { start: customStart ?? appState.customStart, end: customEnd ?? appState.customEnd };
  }
  if (tr === 'ALL') return {};
  const now = Date.now();
  const ms = tr === '1H' ? 3600_000 : tr === '24H' ? 86400_000 : 7 * 86400_000;
  return { start: new Date(now - ms).toISOString() };
}

function buildFilterFromRequest(req: Request): ReportFilter {
  const body = (req.body || {}) as any;
  const appState = getAppState();

  const sensorId: string | undefined = body.sensorId ?? appState.selectedSensorId ?? undefined;
  const statusFilter: any = body.statusFilter ?? appState.statusFilter ?? 'ALL';
  const timeRange = resolveTimeRange(
    appState,
    body.customStart,
    body.customEnd,
  );

  const filter: ReportFilter = {};
  if (sensorId) filter.sensorId = sensorId;
  if (statusFilter) filter.statusFilter = statusFilter;
  filter.timeRange = timeRange;

  return filter;
}

const router = Router();

router.post('/csv', (req: Request, res: Response) => {
  const filter = buildFilterFromRequest(req);
  const csv = generateCsvReport(filter);
  const fileName = `qc_report_${Date.now()}.csv`;
  const filePath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf-8');
  insertAuditLog({
    action: 'REPORT_EXPORT',
    entityType: 'report',
    entityId: fileName,
    detail: `CSV导出，筛选：sensor=${filter.sensorId || '全部'}, status=${filter.statusFilter || 'ALL'}, range=${JSON.stringify(filter.timeRange)}`,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send('\uFEFF' + csv);
});

router.post('/pdf', (req: Request, res: Response) => {
  const filter = buildFilterFromRequest(req);
  const buf = generatePdfReport(filter);
  const fileName = `qc_report_${Date.now()}.pdf`;
  const filePath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(buf));
  insertAuditLog({
    action: 'REPORT_EXPORT',
    entityType: 'report',
    entityId: fileName,
    detail: `PDF导出，筛选：sensor=${filter.sensorId || '全部'}, status=${filter.statusFilter || 'ALL'}, range=${JSON.stringify(filter.timeRange)}`,
  });
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

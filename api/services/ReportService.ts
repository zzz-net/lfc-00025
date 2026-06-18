import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
const jsPDFConstructor = (jsPDF as any).default || jsPDF;
const autoTableFn = (autoTable as any).default || autoTable;
import { findAllSensors } from '../repositories/SensorRepo.js';
import { findAllAnomalies } from '../repositories/AnomalyRepo.js';
import { findAnnotationHistoryByFilter } from '../repositories/AnnotationRepo.js';
import { getThresholdConfig } from '../repositories/ConfigRepo.js';
import { countReadings } from '../repositories/ReadingRepo.js';
import { ANOMALY_TYPE_LABELS, STATUS_LABELS, type AnnotationStatus } from '../../shared/types.js';

export interface ReportFilter {
  sensorId?: string;
  statusFilter?: 'ALL' | AnnotationStatus;
  timeRange?: { start?: string; end?: string };
}

export function generateCsvReport(filter: ReportFilter = {}): string {
  const anomalies = findAllAnomalies(filter.sensorId, filter.statusFilter, filter.timeRange);
  const threshold = getThresholdConfig();
  const rows = anomalies.map((a) => ({
    异常ID: a.id.substring(0, 12),
    传感器: a.sensorName,
    传感器ID: a.sensorId,
    类型: ANOMALY_TYPE_LABELS[a.type] || a.type,
    描述: a.description,
    检测时间: a.detectedAt,
    读数时间: a.reading?.timestamp || '',
    温度: a.reading?.temperature ?? '',
    湿度: a.reading?.humidity ?? '',
    当前状态: STATUS_LABELS[a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED')] || 'DETECTED',
    处理人: a.latestAnnotation?.handler || '',
    处理原因: a.latestAnnotation?.reason || '',
    标注时间: a.latestAnnotation?.createdAt || '',
    是否回滚: a.latestAnnotation?.rolledBackAt ? '是' : '否',
    回滚原因: a.latestAnnotation?.rollbackReason || '',
  }));

  let csv = Papa.unparse(rows);

  csv += '\n\n===== 报告生成时生效的阈值配置 =====\n';
  csv += `# 导出时间: ${new Date().toISOString()}\n`;
  csv += `# 筛选条件: 传感器=${filter.sensorId || '全部'}, 状态=${filter.statusFilter || 'ALL'}, 时间范围=${JSON.stringify(filter.timeRange || {})}\n`;
  csv += Papa.unparse([
    { 配置项: '温度下限 (℃)', 数值: threshold.tempMin, 说明: '读数温度低于此值判定为越下限异常' },
    { 配置项: '温度上限 (℃)', 数值: threshold.tempMax, 说明: '读数温度高于此值判定为越上限异常' },
    { 配置项: '湿度下限 (%)', 数值: threshold.humidMin, 说明: '读数湿度低于此值判定为越下限异常' },
    { 配置项: '湿度上限 (%)', 数值: threshold.humidMax, 说明: '读数湿度高于此值判定为越上限异常' },
    { 配置项: '温度漂移阈值 (℃)', 数值: threshold.tempDriftThreshold, 说明: '相邻读数温度差超过判定为漂移异常' },
    { 配置项: '湿度漂移阈值 (%)', 数值: threshold.humidDriftThreshold, 说明: '相邻读数湿度差超过判定为漂移异常' },
    { 配置项: '断点时间阈值 (秒)', 数值: threshold.gapThresholdSeconds, 说明: '相邻读数时间间隔超过判定为数据断点' },
  ]);

  const history = findAnnotationHistoryByFilter(500, filter);
  csv += '\n\n===== 标注历史 =====\n';
  csv += Papa.unparse(history.map((h) => ({
    标注ID: h.id.substring(0, 12),
    传感器: h.sensorName,
    异常类型: ANOMALY_TYPE_LABELS[h.anomalyType!] || h.anomalyType,
    读数时间: h.timestamp,
    状态: STATUS_LABELS[h.status] || h.status,
    处理人: h.handler,
    原因: h.reason,
    标注时间: h.createdAt,
    是否已回滚: h.rolledBackAt ? '是' : '否',
    回滚原因: h.rollbackReason || '',
  })));

  return csv;
}

export function generatePdfReport(filter: ReportFilter = {}): Uint8Array {
  const doc = new jsPDFConstructor({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const sensors = findAllSensors();
  const anomalies = findAllAnomalies(filter.sensorId, filter.statusFilter, filter.timeRange);
  const threshold = getThresholdConfig();
  const totalReadings = countReadings();
  const history = findAnnotationHistoryByFilter(200, filter);

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('实验室传感器质控分析报告', pageWidth / 2, 50, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`生成时间: ${new Date().toLocaleString('zh-CN')}`, pageWidth / 2, 70, { align: 'center' });

  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const a of anomalies) {
    const s = a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED');
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  }

  autoTableFn(doc, {
    startY: 95,
    head: [['项目', '数值']],
    body: [
      ['传感器总数', sensors.length],
      ['读数总条数', totalReadings],
      ['异常总数', anomalies.length],
      ['待处理', statusCounts['DETECTED'] || 0],
      ['待确认', statusCounts['PENDING'] || 0],
      ['已接受', statusCounts['ACCEPTED'] || 0],
      ['误报', statusCounts['FALSE_POSITIVE'] || 0],
      ['需复测', statusCounts['RETEST'] || 0],
    ],
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  let cursor = (doc as any).lastAutoTable.finalY + 20;

  autoTableFn(doc, {
    startY: cursor,
    head: [['阈值配置项', '数值']],
    body: [
      ['温度下限 (℃)', threshold.tempMin],
      ['温度上限 (℃)', threshold.tempMax],
      ['湿度下限 (%)', threshold.humidMin],
      ['湿度上限 (%)', threshold.humidMax],
      ['温度漂移阈值 (℃)', threshold.tempDriftThreshold],
      ['湿度漂移阈值 (%)', threshold.humidDriftThreshold],
      ['断点时间阈值 (秒)', threshold.gapThresholdSeconds],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] },
  });

  cursor = (doc as any).lastAutoTable.finalY + 20;

  autoTableFn(doc, {
    startY: cursor,
    head: [['异常类型', '数量']],
    body: Object.entries(typeCounts).map(([k, v]) => [
      ANOMALY_TYPE_LABELS[k as keyof typeof ANOMALY_TYPE_LABELS] || k,
      v,
    ]),
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [239, 68, 68] },
  });

  doc.addPage();
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('异常明细列表', 40, 40);

  autoTableFn(doc, {
    startY: 55,
    head: [['传感器', '类型', '描述', '读数时间', '状态', '处理人']],
    body: anomalies.slice(0, 150).map((a) => [
      a.sensorName || '',
      ANOMALY_TYPE_LABELS[a.type] || a.type,
      a.description.substring(0, 50),
      a.reading?.timestamp.substring(0, 19).replace('T', ' ') || '',
      STATUS_LABELS[a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED')] || 'DETECTED',
      a.latestAnnotation?.handler || '',
    ]),
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 4) {
        const cell = data.cell;
        const text = cell.text[0];
        const colors: Record<string, [number, number, number]> = {
          '待处理': [239, 68, 68],
          '待确认': [245, 158, 11],
          '已接受': [16, 185, 129],
          '误报': [107, 114, 128],
          '需复测': [59, 130, 246],
        };
        const c = colors[text];
        if (c) {
          doc.setTextColor(c[0], c[1], c[2]);
          doc.setFont('helvetica', 'bold');
        }
      }
    },
  });

  if (history.length > 0) {
    doc.addPage();
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('标注操作历史（最近200条）', 40, 40);
    autoTableFn(doc, {
      startY: 55,
      head: [['时间', '传感器', '状态', '处理人', '原因', '回滚']],
      body: history.map((h) => [
        h.createdAt.substring(0, 19).replace('T', ' '),
        h.sensorName || '',
        STATUS_LABELS[h.status] || h.status,
        h.handler,
        h.reason.substring(0, 30),
        h.rolledBackAt ? `是 (${h.rollbackReason || ''})` : '否',
      ]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [139, 92, 246], fontSize: 8 },
    });
  }

  const buffer = doc.output('arraybuffer');
  return new Uint8Array(buffer);
}

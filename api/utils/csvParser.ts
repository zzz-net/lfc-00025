import Papa from 'papaparse';
import type { ImportError, Reading, Sensor } from '../../shared/types.js';
import { generateId } from './fileHash.js';

export interface ParseResult {
  sensors: Sensor[];
  readings: Reading[];
  errors: ImportError[];
  totalRows: number;
  validRows: number;
}

const SENSOR_NAME_MAP: Record<string, string> = {
  sensor_id: 'sensorId',
  sensorid: 'sensorId',
  sensor: 'sensorId',
  device_id: 'sensorId',
  deviceid: 'sensorId',
  device: 'sensorId',
  设备编号: 'sensorId',
  传感器编号: 'sensorId',
  设备: 'sensorId',
  传感器: 'sensorId',
  ts: 'timestamp',
  time: 'timestamp',
  datetime: 'timestamp',
  时间: 'timestamp',
  时间戳: 'timestamp',
  采集时间: 'timestamp',
  temp: 'temperature',
  t: 'temperature',
  温度: 'temperature',
  气温: 'temperature',
  humid: 'humidity',
  h: 'humidity',
  rh: 'humidity',
  湿度: 'humidity',
  相对湿度: 'humidity',
  sensor_name: 'sensorName',
  sensorname: 'sensorName',
  设备名称: 'sensorName',
  传感器名称: 'sensorName',
  名称: 'sensorName',
  location: 'location',
  loc: 'location',
  位置: 'location',
  地点: 'location',
  model: 'model',
  型号: 'model',
};

function normalizeHeaders(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.trim().toLowerCase().replace(/[\s_-]/g, '_');
    const mapped = SENSOR_NAME_MAP[key] || SENSOR_NAME_MAP[k.trim()] || k.trim();
    result[mapped] = v;
  }
  return result;
}

function isValidTimestamp(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function toIsoTimestamp(s: string): string {
  const d = new Date(s);
  return d.toISOString();
}

function parseNumber(v: any): { ok: boolean; value: number; raw: string } {
  if (v === null || v === undefined || v === '') {
    return { ok: false, value: NaN, raw: String(v ?? '') };
  }
  const s = String(v).trim().replace(/[^\d.\-eE+]/g, '');
  if (s === '' || s === '.' || s === '-') {
    return { ok: false, value: NaN, raw: String(v) };
  }
  const n = Number(s);
  return { ok: !isNaN(n) && isFinite(n), value: n, raw: String(v) };
}

export function parseCsvContent(content: string, batchId: string): ParseResult {
  const errors: ImportError[] = [];
  const sensorMap = new Map<string, Sensor>();
  const readings: Reading[] = [];

  let rows = Papa.parse<Record<string, any>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  }).data;

  rows = rows.map(normalizeHeaders);
  const totalRows = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const rawRow = i + 2;
    const row = rows[i];
    const rowErrors: ImportError[] = [];

    const sensorId = String(row.sensorId ?? row.device ?? '').trim();
    if (!sensorId) {
      rowErrors.push({
        row: rawRow,
        field: 'sensorId',
        value: '',
        message: '缺少传感器编号',
      });
    }

    const tsStr = String(row.timestamp ?? '').trim();
    if (!tsStr) {
      rowErrors.push({
        row: rawRow,
        field: 'timestamp',
        value: '',
        message: '缺少时间戳',
      });
    } else if (!isValidTimestamp(tsStr)) {
      rowErrors.push({
        row: rawRow,
        field: 'timestamp',
        value: tsStr,
        message: '时间戳格式无效',
      });
    }

    const temp = parseNumber(row.temperature);
    if (!temp.ok) {
      rowErrors.push({
        row: rawRow,
        field: 'temperature',
        value: temp.raw,
        message: '温度不是有效数字',
      });
    }

    const humid = parseNumber(row.humidity);
    if (!humid.ok) {
      rowErrors.push({
        row: rawRow,
        field: 'humidity',
        value: humid.raw,
        message: '湿度不是有效数字',
      });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    if (!sensorMap.has(sensorId)) {
      sensorMap.set(sensorId, {
        id: sensorId,
        name: String(row.sensorName ?? sensorId).trim(),
        location: String(row.location ?? '').trim(),
        model: String(row.model ?? '').trim(),
        createdAt: new Date().toISOString(),
      });
    }

    readings.push({
      id: generateId('r_'),
      sensorId,
      timestamp: toIsoTimestamp(tsStr),
      temperature: temp.value,
      humidity: humid.value,
      batchId,
      rawRow,
    });
  }

  readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    sensors: Array.from(sensorMap.values()),
    readings,
    errors,
    totalRows,
    validRows: readings.length,
  };
}

export function parseJsonContent(content: string, batchId: string): ParseResult {
  let data: any;
  try {
    data = JSON.parse(content);
  } catch (_e) {
    return {
      sensors: [],
      readings: [],
      errors: [{ row: 0, field: '__json__', value: '', message: 'JSON格式错误' }],
      totalRows: 0,
      validRows: 0,
    };
  }

  const rows: Record<string, any>[] = Array.isArray(data) ? data : (data.data || data.readings || []);
  const csvRows = Papa.unparse(rows.map(normalizeHeaders));
  return parseCsvContent(csvRows, batchId);
}

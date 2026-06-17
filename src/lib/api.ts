import type {
  Sensor, Reading, Anomaly, Annotation, ThresholdConfig,
  ImportResponse, ImportBatch, AppState, AnnotationStatus,
} from '../../shared/types.js';

const BASE = '/api';

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `请求失败 ${res.status}`);
  }
  return data;
}

export const api = {
  sensors: {
    list: () => req<{ success: boolean; data: Sensor[] }>('/sensors'),
    get: (id: string) => req<{ success: boolean; data: Sensor }>(`/sensors/${id}`),
    readings: (id: string, start?: string, end?: string) => {
      const qs = new URLSearchParams();
      if (start) qs.set('start', start);
      if (end) qs.set('end', end);
      const q = qs.toString();
      return req<{ success: boolean; data: Reading[] }>(`/sensors/${id}/readings${q ? '?' + q : ''}`);
    },
    anomalies: (id: string, status?: string) => {
      const q = status ? `?status=${status}` : '';
      return req<{ success: boolean; data: Anomaly[] }>(`/sensors/${id}/anomalies${q}`);
    },
  },
  import: {
    sample: () => req<ImportResponse>('/import/sample', { method: 'POST' }),
    upload: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return fetch(BASE + '/import/upload', { method: 'POST', body: fd })
        .then(async (r) => ({ status: r.status, data: await r.json() as ImportResponse }));
    },
    verify: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return fetch(BASE + '/import/verify', { method: 'POST', body: fd })
        .then(async (r) => ({ status: r.status, data: await r.json() }));
    },
    batches: () => req<{ success: boolean; data: ImportBatch[] }>('/import/batches'),
  },
  anomalies: {
    list: (sensorId?: string, status?: string, start?: string, end?: string) => {
      const qs = new URLSearchParams();
      if (sensorId) qs.set('sensorId', sensorId);
      if (status) qs.set('status', status);
      if (start) qs.set('start', start);
      if (end) qs.set('end', end);
      const q = qs.toString();
      return req<{ success: boolean; data: Anomaly[] }>(`/anomalies${q ? '?' + q : ''}`);
    },
    get: (id: string) => req<{ success: boolean; data: Anomaly }>(`/anomalies/${id}`),
    annotate: (id: string, body: { status: AnnotationStatus; handler: string; reason: string }) =>
      req<{ success: boolean; data: Annotation }>(`/anomalies/${id}/annotate`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    detect: () => req<{ success: boolean; data: any }>('/anomalies/detect', { method: 'POST' }),
    thresholds: () => req<{ success: boolean; data: ThresholdConfig }>('/anomalies/thresholds'),
    updateThresholds: (body: Partial<ThresholdConfig>) =>
      req<{ success: boolean; data: { threshold: ThresholdConfig; detectionStats: any } }>(
        '/anomalies/thresholds',
        { method: 'PUT', body: JSON.stringify(body) },
      ),
  },
  annotations: {
    history: (limit = 200) => req<{ success: boolean; data: Annotation[] }>(`/annotations/history?limit=${limit}`),
    latest: () => req<{ success: boolean; data: Annotation | null }>('/annotations/latest'),
    rollback: (reason?: string) =>
      req<{ success: boolean; data: Annotation }>('/annotations/rollback', {
        method: 'POST', body: JSON.stringify({ reason }),
      }),
  },
  report: {
    csv: () => window.open(BASE + '/report/csv', '_blank'),
    pdf: () => window.open(BASE + '/report/pdf', '_blank'),
    list: () => req<{ success: boolean; data: any[] }>('/report/list'),
    downloadCsv: async (filter?: {
      sensorId?: string | null;
      statusFilter?: any;
      timeRange?: any;
      customStart?: string;
      customEnd?: string;
    }) => {
      const res = await fetch(BASE + '/report/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: filter ? JSON.stringify(filter) : undefined,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fn = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'report.csv';
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    downloadPdf: async (filter?: {
      sensorId?: string | null;
      statusFilter?: any;
      timeRange?: any;
      customStart?: string;
      customEnd?: string;
    }) => {
      const res = await fetch(BASE + '/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: filter ? JSON.stringify(filter) : undefined,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fn = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'report.pdf';
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  state: {
    get: () => req<{ success: boolean; data: AppState }>('/state'),
    save: (body: Partial<AppState>) =>
      req<{ success: boolean; data: AppState }>('/state', { method: 'PUT', body: JSON.stringify(body) }),
  },
};

export default api;

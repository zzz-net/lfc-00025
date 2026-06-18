import type {
  Sensor, Reading, Anomaly, Annotation, ThresholdConfig,
  ImportResponse, ImportBatch, AppState, AnnotationStatus,
  ThresholdPreviewResult, AuditLog, WorkOrder, WorkOrderHistory,
  WorkOrderFilter, WorkOrderPriority, WorkOrderStatus,
  SandboxRule, SandboxPlayback, SandboxComparisonResult,
  SandboxAnomaly, SandboxState, PublishConflictInfo,
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
    previewThresholds: (body: Partial<ThresholdConfig>) =>
      req<{ success: boolean; data: ThresholdPreviewResult }>(
        '/anomalies/thresholds/preview',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    thresholdHistory: (limit = 50) =>
      req<{ success: boolean; data: AuditLog[] }>(`/anomalies/thresholds/history?limit=${limit}`),
    updateThresholds: (body: Partial<ThresholdConfig> & { operator?: string }) =>
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
  workorders: {
    list: (filter?: WorkOrderFilter) => {
      const qs = new URLSearchParams();
      if (filter?.assignee) qs.set('assignee', filter.assignee);
      if (filter?.status && filter.status !== 'ALL') qs.set('status', filter.status);
      if (filter?.sensorId) qs.set('sensorId', filter.sensorId);
      if (filter?.priority && filter.priority !== 'ALL') qs.set('priority', filter.priority);
      const q = qs.toString();
      return req<{ success: boolean; data: WorkOrder[] }>(`/workorders${q ? '?' + q : ''}`);
    },
    get: (id: string) => req<{ success: boolean; data: WorkOrder }>(`/workorders/${id}`),
    history: (id: string) => req<{ success: boolean; data: WorkOrderHistory[] }>(`/workorders/${id}/history`),
    assignees: () => req<{ success: boolean; data: string[] }>('/workorders/assignees'),
    create: (body: {
      anomalyId: string;
      title: string;
      priority: WorkOrderPriority;
      assignee: string;
      creator: string;
      deadline?: string;
      remark?: string;
    }) => req<{ success: boolean; data: WorkOrder; conflict?: boolean; conflictWorkOrder?: WorkOrder }>(
      '/workorders', { method: 'POST', body: JSON.stringify(body) },
    ),
    reassign: (id: string, body: { assignee: string; operator: string; remark?: string }) =>
      req<{ success: boolean; data: WorkOrder }>(`/workorders/${id}/reassign`, {
        method: 'PUT', body: JSON.stringify(body),
      }),
    updateStatus: (id: string, body: { status: WorkOrderStatus; operator: string; closeReason?: string }) =>
      req<{ success: boolean; data: WorkOrder }>(`/workorders/${id}/status`, {
        method: 'PUT', body: JSON.stringify(body),
      }),
    reopen: (id: string, body: { operator: string }) =>
      req<{ success: boolean; data: WorkOrder }>(`/workorders/${id}/reopen`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    update: (id: string, body: {
      operator: string;
      priority?: WorkOrderPriority;
      deadline?: string;
      remark?: string;
      title?: string;
    }) => req<{ success: boolean; data: WorkOrder }>(`/workorders/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
    exportCsv: async (filter?: WorkOrderFilter) => {
      const res = await fetch(BASE + '/workorders/export/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: filter ? JSON.stringify(filter) : undefined,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fn = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'work_orders.csv';
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  sandbox: {
    rules: {
      list: () => req<{ success: boolean; data: SandboxRule[] }>('/sandbox/rules'),
      get: (id: string) => req<{ success: boolean; data: SandboxRule }>(`/sandbox/rules/${id}`),
      create: (body: {
        name?: string; description?: string; threshold?: ThresholdConfig;
        copyFromLive?: boolean; operator?: string;
      }) => req<{ success: boolean; data: SandboxRule }>('/sandbox/rules', {
        method: 'POST', body: JSON.stringify(body),
      }),
      update: (id: string, body: {
        name?: string; description?: string; threshold?: ThresholdConfig; operator?: string;
      }) => req<{ success: boolean; data: SandboxRule }>(`/sandbox/rules/${id}`, {
        method: 'PUT', body: JSON.stringify(body),
      }),
      delete: (id: string, operator?: string) => {
        const q = operator ? `?operator=${encodeURIComponent(operator)}` : '';
        return req<{ success: boolean }>(`/sandbox/rules/${id}${q}`, { method: 'DELETE' });
      },
      copy: (id: string, body: { newName?: string; operator?: string }) =>
        req<{ success: boolean; data: SandboxRule }>(`/sandbox/rules/${id}/copy`, {
          method: 'POST', body: JSON.stringify(body),
        }),
      playbacks: (id: string) =>
        req<{ success: boolean; data: SandboxPlayback[] }>(`/sandbox/rules/${id}/playbacks`),
      playbackSensors: (id: string, body: {
        name?: string; sensorIds?: string[];
        timeStart?: string; timeEnd?: string; operator?: string;
      }) => req<{ success: boolean; data: SandboxPlayback }>(`/sandbox/rules/${id}/playback/sensors`, {
        method: 'POST', body: JSON.stringify(body),
      }),
      playbackCsv: (id: string, file: File, name?: string, operator?: string) => {
        const fd = new FormData();
        fd.append('file', file);
        if (name) fd.append('name', name);
        if (operator) fd.append('operator', operator);
        return fetch(BASE + `/sandbox/rules/${id}/playback/csv`, {
          method: 'POST', body: fd,
        }).then(async (r) => ({ status: r.status, data: await r.json() as { success: boolean; data: SandboxPlayback; error?: string } }));
      },
      conflict: (id: string) =>
        req<{ success: boolean; data: PublishConflictInfo }>(`/sandbox/rules/${id}/conflict`),
      publish: (id: string, body: { force?: boolean; operator?: string }) =>
        req<{ success: boolean; message: string; conflict?: PublishConflictInfo }>(
          `/sandbox/rules/${id}/publish`, { method: 'POST', body: JSON.stringify(body) },
        ),
    },
    playbacks: {
      get: (id: string) => req<{ success: boolean; data: SandboxPlayback }>(`/sandbox/playbacks/${id}`),
      comparison: (id: string) =>
        req<{ success: boolean; data: SandboxComparisonResult }>(`/sandbox/playbacks/${id}/comparison`),
      anomalies: (id: string, options?: {
        sensorId?: string; type?: string; onlyNew?: boolean; onlyMissing?: boolean; limit?: number;
      }) => {
        const qs = new URLSearchParams();
        if (options?.sensorId) qs.set('sensorId', options.sensorId);
        if (options?.type) qs.set('type', options.type);
        if (options?.onlyNew) qs.set('onlyNew', 'true');
        if (options?.onlyMissing) qs.set('onlyMissing', 'true');
        if (options?.limit) qs.set('limit', String(options.limit));
        const q = qs.toString();
        return req<{ success: boolean; data: SandboxAnomaly[] }>(
          `/sandbox/playbacks/${id}/anomalies${q ? '?' + q : ''}`,
        );
      },
      exportCsv: async (id: string, operator?: string) => {
        const q = operator ? `?operator=${encodeURIComponent(operator)}` : '';
        const res = await fetch(BASE + `/sandbox/playbacks/${id}/export${q}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fn = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'sandbox_comparison.csv';
        a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      delete: (id: string, operator?: string) => {
        const q = operator ? `?operator=${encodeURIComponent(operator)}` : '';
        return req<{ success: boolean }>(`/sandbox/playbacks/${id}${q}`, { method: 'DELETE' });
      },
    },
    state: {
      get: () => req<{ success: boolean; data: SandboxState }>('/sandbox/state'),
      save: (body: Partial<SandboxState> & { operator?: string }) =>
        req<{ success: boolean; data: SandboxState }>('/sandbox/state', {
          method: 'POST', body: JSON.stringify(body),
        }),
    },
  },
};

export default api;

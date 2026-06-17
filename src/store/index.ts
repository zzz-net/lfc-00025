import { create } from 'zustand';
import api from '@/lib/api';
import type {
  Sensor, Reading, Anomaly, Annotation, ThresholdConfig,
  AnnotationStatus,
} from '../../shared/types.js';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface QCStore {
  sensors: Sensor[];
  selectedSensorId: string | null;
  readings: Reading[];
  anomalies: Anomaly[];
  annotationsHistory: Annotation[];
  thresholds: ThresholdConfig;
  statusFilter: 'ALL' | AnnotationStatus;
  timeRange: 'ALL' | '1H' | '24H' | '7D' | 'CUSTOM';
  customStart?: string;
  customEnd?: string;
  loading: Record<string, boolean>;
  toasts: Toast[];
  importResult: null | any;

  loadAll: () => Promise<void>;
  loadSensors: () => Promise<void>;
  selectSensor: (id: string | null) => Promise<void>;
  loadReadings: (id: string) => Promise<void>;
  loadAnomalies: (sensorId?: string) => Promise<void>;
  loadThresholds: () => Promise<void>;
  updateThresholds: (cfg: Partial<ThresholdConfig>) => Promise<void>;
  annotate: (anomalyId: string, body: { status: AnnotationStatus; handler: string; reason: string }) => Promise<void>;
  rollbackLast: (reason?: string) => Promise<void>;
  loadAnnotationHistory: () => Promise<void>;
  importSample: () => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  setStatusFilter: (s: 'ALL' | AnnotationStatus) => void;
  setTimeRange: (r: 'ALL' | '1H' | '24H' | '7D' | 'CUSTOM', s?: string, e?: string) => void;
  addToast: (t: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  persistState: () => Promise<void>;
  _setLoading: (key: string, v: boolean) => void;
  getTimeRangeParams: () => { start?: string; end?: string };
  exportReport: (type: 'csv' | 'pdf') => Promise<void>;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  tempMin: 15, tempMax: 30, humidMin: 30, humidMax: 70,
  tempDriftThreshold: 2, humidDriftThreshold: 10, gapThresholdSeconds: 600,
};

export const useQCStore = create<QCStore>((set, get) => ({
  sensors: [],
  selectedSensorId: null,
  readings: [],
  anomalies: [],
  annotationsHistory: [],
  thresholds: DEFAULT_THRESHOLDS,
  statusFilter: 'ALL',
  timeRange: 'ALL',
  customStart: undefined,
  customEnd: undefined,
  loading: {},
  toasts: [],
  importResult: null,

  addToast: (t) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    set((s) => ({ toasts: [...s.toasts, { id, ...t }] }));
    setTimeout(() => get().removeToast(id), 4000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  _setLoading: (key: string, v: boolean) =>
    set((s) => ({ loading: { ...s.loading, [key]: v } })),

  loadSensors: async () => {
    get()._setLoading('sensors', true);
    try {
      const res = await api.sensors.list();
      set({ sensors: res.data });
      if (!get().selectedSensorId && res.data.length > 0) {
        await get().selectSensor(res.data[0].id);
      }
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载传感器失败: ' + e.message });
    } finally {
      get()._setLoading('sensors', false);
    }
  },

  selectSensor: async (id) => {
    set({ selectedSensorId: id });
    if (id) {
      await Promise.all([get().loadReadings(id), get().loadAnomalies(id)]);
    }
    await get().persistState();
  },

  loadReadings: async (id) => {
    get()._setLoading('readings', true);
    try {
      const { start, end } = get().getTimeRangeParams();
      const res = await api.sensors.readings(id, start, end);
      set({ readings: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载读数失败: ' + e.message });
    } finally {
      get()._setLoading('readings', false);
    }
  },

  getTimeRangeParams: (): { start?: string; end?: string } => {
    const { timeRange, customStart, customEnd } = get();
    if (timeRange === 'CUSTOM') return { start: customStart, end: customEnd };
    if (timeRange === 'ALL') return {};
    const now = Date.now();
    const ms = timeRange === '1H' ? 3600_000 : timeRange === '24H' ? 86400_000 : 7 * 86400_000;
    return { start: new Date(now - ms).toISOString() };
  },

  loadAnomalies: async (sensorId?) => {
    get()._setLoading('anomalies', true);
    try {
      const sid = sensorId ?? get().selectedSensorId ?? undefined;
      const status = get().statusFilter === 'ALL' ? undefined : get().statusFilter;
      const { start, end } = get().getTimeRangeParams();
      const res = await api.anomalies.list(sid, status, start, end);
      set({ anomalies: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载异常失败: ' + e.message });
    } finally {
      get()._setLoading('anomalies', false);
    }
  },

  loadThresholds: async () => {
    try {
      const res = await api.anomalies.thresholds();
      set({ thresholds: res.data });
    } catch { /* ignore */ }
  },

  updateThresholds: async (cfg) => {
    get()._setLoading('thresholds', true);
    try {
      const res = await api.anomalies.updateThresholds(cfg);
      set({ thresholds: res.data.threshold });
      get().addToast({
        type: 'success',
        message: `阈值已更新，重算异常完成：新增 ${res.data.detectionStats.newAnomalies} 条，保护人工结论 ${res.data.detectionStats.protectedCount} 条`,
      });
      await get().loadAnomalies();
      const sel = get().selectedSensorId;
      if (sel) await get().loadReadings(sel);
      await get().loadSensors();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '更新阈值失败: ' + e.message });
    } finally {
      get()._setLoading('thresholds', false);
    }
  },

  annotate: async (anomalyId, body) => {
    try {
      await api.anomalies.annotate(anomalyId, body);
      get().addToast({ type: 'success', message: '标注成功' });
      await Promise.all([get().loadAnomalies(), get().loadSensors(), get().loadAnnotationHistory()]);
    } catch (e: any) {
      get().addToast({ type: 'error', message: '标注失败: ' + e.message });
    }
  },

  rollbackLast: async (reason) => {
    try {
      await api.annotations.rollback(reason);
      get().addToast({ type: 'success', message: '已回滚最近一次标注' });
      await Promise.all([get().loadAnomalies(), get().loadSensors(), get().loadAnnotationHistory()]);
    } catch (e: any) {
      get().addToast({ type: 'error', message: '回滚失败: ' + e.message });
    }
  },

  loadAnnotationHistory: async () => {
    try {
      const res = await api.annotations.history();
      set({ annotationsHistory: res.data });
    } catch { /* ignore */ }
  },

  importSample: async () => {
    get()._setLoading('import', true);
    try {
      const res = await api.import.sample();
      set({ importResult: res });
      get().addToast({
        type: res.success ? 'success' : 'warning',
        message: res.message || (res.success ? '样例导入成功' : '导入失败'),
      });
      await get().loadAll();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '导入失败: ' + e.message });
    } finally {
      get()._setLoading('import', false);
    }
  },

  uploadFile: async (file) => {
    get()._setLoading('import', true);
    try {
      const r = await api.import.upload(file);
      set({ importResult: r.data });
      get().addToast({
        type: r.data.success ? 'success' : 'warning',
        message: r.data.message || (r.data.success ? '导入成功' : '导入失败'),
      });
      if (r.data.success) await get().loadAll();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '上传失败: ' + e.message });
    } finally {
      get()._setLoading('import', false);
    }
  },

  setStatusFilter: (s) => {
    set({ statusFilter: s });
    void get().persistState();
    void get().loadAnomalies();
  },

  setTimeRange: (r, s, e) => {
    set({ timeRange: r, customStart: s, customEnd: e });
    void get().persistState();
    const sel = get().selectedSensorId;
    if (sel) void get().loadReadings(sel);
    void get().loadAnomalies();
  },

  persistState: async () => {
    try {
      const { selectedSensorId, statusFilter, timeRange, customStart, customEnd } = get();
      await api.state.save({ selectedSensorId, statusFilter, timeRange, customStart, customEnd });
    } catch { /* ignore */ }
  },

  loadAll: async () => {
    get()._setLoading('all', true);
    try {
      const [stateRes] = await Promise.allSettled([api.state.get()]);
      if (stateRes.status === 'fulfilled') {
        const st = stateRes.value.data;
        set({
          selectedSensorId: st.selectedSensorId,
          statusFilter: st.statusFilter || 'ALL',
          timeRange: st.timeRange || 'ALL',
          customStart: st.customStart,
          customEnd: st.customEnd,
        });
      }
      await Promise.all([get().loadSensors(), get().loadThresholds(), get().loadAnnotationHistory()]);
      await get().loadAnomalies();
    } finally {
      get()._setLoading('all', false);
    }
  },

  exportReport: async (type) => {
    try {
      const { selectedSensorId, statusFilter, timeRange, customStart, customEnd } = get();
      const filter = {
        sensorId: selectedSensorId,
        statusFilter,
        timeRange,
        customStart,
        customEnd,
      };
      if (type === 'csv') {
        await api.report.downloadCsv(filter);
      } else {
        await api.report.downloadPdf(filter);
      }
      get().addToast({ type: 'success', message: `${type.toUpperCase()} 报告导出成功，筛选条件已应用` });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '导出失败: ' + e.message });
    }
  },
}));

export default useQCStore;

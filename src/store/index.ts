import { create } from 'zustand';
import api from '@/lib/api';
import type {
  Sensor, Reading, Anomaly, Annotation, ThresholdConfig,
  AnnotationStatus, ThresholdPreviewResult, AuditLog,
  WorkOrder, WorkOrderFilter, WorkOrderPriority, WorkOrderStatus,
  SandboxRule, SandboxPlayback, SandboxComparisonResult,
  SandboxState, PublishConflictInfo, SandboxAnomaly,
  SandboxRuleHistory,
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
  thresholdPreview: ThresholdPreviewResult | null;
  thresholdHistory: AuditLog[];
  statusFilter: 'ALL' | AnnotationStatus;
  timeRange: 'ALL' | '1H' | '24H' | '7D' | 'CUSTOM';
  customStart?: string;
  customEnd?: string;
  loading: Record<string, boolean>;
  toasts: Toast[];
  importResult: null | any;
  workOrders: WorkOrder[];
  workOrderFilter: WorkOrderFilter;
  workOrderAssignees: string[];

  loadAll: () => Promise<void>;
  loadSensors: () => Promise<void>;
  selectSensor: (id: string | null) => Promise<void>;
  loadReadings: (id: string) => Promise<void>;
  loadAnomalies: (sensorId?: string) => Promise<void>;
  loadThresholds: () => Promise<void>;
  previewThresholds: (cfg: Partial<ThresholdConfig>) => Promise<ThresholdPreviewResult | null>;
  loadThresholdHistory: () => Promise<void>;
  updateThresholds: (cfg: Partial<ThresholdConfig> & { operator?: string }) => Promise<void>;
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
  clearThresholdPreview: () => void;
  loadWorkOrders: () => Promise<void>;
  loadWorkOrderAssignees: () => Promise<void>;
  createWorkOrder: (body: {
    anomalyId: string;
    title: string;
    priority: WorkOrderPriority;
    assignee: string;
    creator: string;
    deadline?: string;
    remark?: string;
  }) => Promise<WorkOrder | null>;
  reassignWorkOrder: (id: string, body: { assignee: string; operator: string; remark?: string }) => Promise<void>;
  updateWorkOrderStatus: (id: string, body: { status: WorkOrderStatus; operator: string; closeReason?: string }) => Promise<void>;
  reopenWorkOrder: (id: string, operator: string) => Promise<void>;
  updateWorkOrder: (id: string, body: {
    operator: string;
    priority?: WorkOrderPriority;
    deadline?: string;
    remark?: string;
    title?: string;
  }) => Promise<void>;
  setWorkOrderFilter: (f: Partial<WorkOrderFilter>) => void;
  exportWorkOrdersCsv: () => Promise<void>;

  sandboxRules: SandboxRule[];
  sandboxPlaybacks: SandboxPlayback[];
  selectedSandboxRuleId: string | null;
  selectedPlaybackId: string | null;
  currentSandboxRule: SandboxRule | null;
  currentPlayback: SandboxPlayback | null;
  comparisonResult: SandboxComparisonResult | null;
  sandboxAnomalies: SandboxAnomaly[];
  publishConflict: PublishConflictInfo | null;
  sandboxLoading: Record<string, boolean>;
  sandboxState: SandboxState | null;
  sandboxRuleHistory: SandboxRuleHistory[];

  loadSandboxRules: () => Promise<void>;
  loadSandboxRule: (id: string) => Promise<void>;
  createSandboxRule: (body: { name?: string; description?: string; copyFromLive?: boolean; operator?: string }) => Promise<SandboxRule | null>;
  updateSandboxRule: (id: string, body: { name?: string; description?: string; threshold?: ThresholdConfig; operator?: string }) => Promise<void>;
  deleteSandboxRule: (id: string, operator?: string) => Promise<void>;
  copySandboxRule: (id: string, newName?: string, operator?: string) => Promise<SandboxRule | null>;
  undoSandboxRule: (id: string, operator: string) => Promise<boolean>;
  loadSandboxRuleHistory: (id: string) => Promise<void>;
  selectSandboxRule: (id: string | null) => Promise<void>;
  loadSandboxPlaybacks: (ruleId: string) => Promise<void>;
  runPlaybackFromSensors: (ruleId: string, body: { name?: string; sensorIds?: string[]; timeStart?: string; timeEnd?: string; operator?: string }) => Promise<void>;
  runPlaybackFromCsv: (ruleId: string, file: File, name?: string, operator?: string) => Promise<void>;
  loadComparisonResult: (playbackId: string) => Promise<void>;
  loadSandboxAnomalies: (playbackId: string, options?: any) => Promise<void>;
  selectPlayback: (id: string | null) => Promise<void>;
  checkPublishConflict: (ruleId: string) => Promise<void>;
  publishSandboxRule: (ruleId: string, options?: { force?: boolean; operator?: string }) => Promise<boolean>;
  exportSandboxComparison: (playbackId: string, operator?: string) => Promise<void>;
  loadSandboxState: () => Promise<void>;
  persistSandboxState: () => Promise<void>;
  deletePlayback: (playbackId: string, operator?: string) => Promise<void>;
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
  thresholdPreview: null,
  thresholdHistory: [],
  statusFilter: 'ALL',
  timeRange: 'ALL',
  customStart: undefined,
  customEnd: undefined,
  loading: {},
  toasts: [],
  importResult: null,
  workOrders: [],
  workOrderFilter: { status: 'ALL', priority: 'ALL' },
  workOrderAssignees: [],

  sandboxRules: [],
  sandboxPlaybacks: [],
  selectedSandboxRuleId: null,
  selectedPlaybackId: null,
  currentSandboxRule: null,
  currentPlayback: null,
  comparisonResult: null,
  sandboxAnomalies: [],
  publishConflict: null,
  sandboxLoading: {},
  sandboxState: null,
  sandboxRuleHistory: [],

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

  previewThresholds: async (cfg) => {
    get()._setLoading('thresholdPreview', true);
    try {
      const res = await api.anomalies.previewThresholds(cfg);
      set({ thresholdPreview: res.data });
      return res.data;
    } catch (e: any) {
      get().addToast({ type: 'error', message: '预览失败: ' + e.message });
      return null;
    } finally {
      get()._setLoading('thresholdPreview', false);
    }
  },

  loadThresholdHistory: async () => {
    try {
      const res = await api.anomalies.thresholdHistory();
      set({ thresholdHistory: res.data });
    } catch { /* ignore */ }
  },

  clearThresholdPreview: () => {
    set({ thresholdPreview: null });
  },

  updateThresholds: async (cfg) => {
    get()._setLoading('thresholds', true);
    try {
      const res = await api.anomalies.updateThresholds(cfg);
      set({ thresholds: res.data.threshold, thresholdPreview: null });
      get().addToast({
        type: 'success',
        message: `阈值已更新，重算异常完成：新增 ${res.data.detectionStats.newAnomalies} 条，保护人工结论 ${res.data.detectionStats.protectedCount} 条`,
      });
      await Promise.all([get().loadAnomalies(), get().loadThresholdHistory()]);
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
      const { selectedSensorId, statusFilter, timeRange, customStart, customEnd, workOrderFilter, workOrderView } = get() as any;
      await api.state.save({
        selectedSensorId, statusFilter, timeRange, customStart, customEnd,
        workOrderFilter,
        view: { workOrderView },
      });
    } catch { /* ignore */ }
  },

  loadAll: async () => {
    get()._setLoading('all', true);
    try {
      const [stateRes] = await Promise.allSettled([api.state.get()]);
      if (stateRes.status === 'fulfilled') {
        const st = stateRes.value.data as any;
        set({
          selectedSensorId: st.selectedSensorId,
          statusFilter: st.statusFilter || 'ALL',
          timeRange: st.timeRange || 'ALL',
          customStart: st.customStart,
          customEnd: st.customEnd,
          workOrderFilter: st.workOrderFilter || { status: 'ALL', priority: 'ALL' },
        });
      }
      await Promise.all([
        get().loadSensors(), get().loadThresholds(), get().loadAnnotationHistory(), get().loadThresholdHistory(),
        get().loadWorkOrders(), get().loadWorkOrderAssignees(),
      ]);
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

  loadWorkOrders: async () => {
    get()._setLoading('workOrders', true);
    try {
      const filter = get().workOrderFilter;
      const res = await api.workorders.list(filter);
      set({ workOrders: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载工单失败: ' + e.message });
    } finally {
      get()._setLoading('workOrders', false);
    }
  },

  loadWorkOrderAssignees: async () => {
    try {
      const res = await api.workorders.assignees();
      set({ workOrderAssignees: res.data });
    } catch { /* ignore */ }
  },

  createWorkOrder: async (body) => {
    try {
      const res = await api.workorders.create(body);
      get().addToast({ type: 'success', message: '工单创建成功' });
      await Promise.all([get().loadWorkOrders(), get().loadWorkOrderAssignees()]);
      return res.data;
    } catch (e: any) {
      const msg = e.message || '创建工单失败';
      if (msg.includes('已存在未关闭')) {
        get().addToast({ type: 'warning', message: msg });
      } else {
        get().addToast({ type: 'error', message: msg });
      }
      return null;
    }
  },

  reassignWorkOrder: async (id, body) => {
    try {
      await api.workorders.reassign(id, body);
      get().addToast({ type: 'success', message: '改派成功' });
      await Promise.all([get().loadWorkOrders(), get().loadWorkOrderAssignees()]);
    } catch (e: any) {
      get().addToast({ type: 'error', message: '改派失败: ' + e.message });
    }
  },

  updateWorkOrderStatus: async (id, body) => {
    try {
      await api.workorders.updateStatus(id, body);
      const label = body.status === 'CLOSED' ? '关闭' : body.status === 'IN_PROGRESS' ? '开始处理' : '转回待处理';
      get().addToast({ type: 'success', message: `${label}成功` });
      await get().loadWorkOrders();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '操作失败: ' + e.message });
    }
  },

  reopenWorkOrder: async (id, operator) => {
    try {
      await api.workorders.reopen(id, { operator });
      get().addToast({ type: 'success', message: '撤销关闭成功，工单已恢复为处理中' });
      await get().loadWorkOrders();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '撤销关闭失败: ' + e.message });
    }
  },

  updateWorkOrder: async (id, body) => {
    try {
      await api.workorders.update(id, body);
      get().addToast({ type: 'success', message: '工单信息已更新' });
      await get().loadWorkOrders();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '更新失败: ' + e.message });
    }
  },

  setWorkOrderFilter: (f) => {
    const cur = get().workOrderFilter;
    set({ workOrderFilter: { ...cur, ...f } });
    void get().persistState();
    void get().loadWorkOrders();
  },

  exportWorkOrdersCsv: async () => {
    try {
      const filter = get().workOrderFilter;
      await api.workorders.exportCsv(filter);
      get().addToast({ type: 'success', message: '工单 CSV 导出成功' });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '导出失败: ' + e.message });
    }
  },

  loadSandboxRules: async () => {
    get()._setLoading('sandboxRules', true);
    try {
      const res = await api.sandbox.rules.list();
      set({ sandboxRules: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载沙盒规则失败: ' + e.message });
    } finally {
      get()._setLoading('sandboxRules', false);
    }
  },

  loadSandboxRule: async (id) => {
    try {
      const res = await api.sandbox.rules.get(id);
      set({ currentSandboxRule: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载规则详情失败: ' + e.message });
    }
  },

  createSandboxRule: async (body) => {
    get()._setLoading('createSandboxRule', true);
    try {
      const res = await api.sandbox.rules.create(body);
      get().addToast({ type: 'success', message: '规则创建成功' });
      await get().loadSandboxRules();
      return res.data;
    } catch (e: any) {
      get().addToast({ type: 'error', message: '创建失败: ' + e.message });
      return null;
    } finally {
      get()._setLoading('createSandboxRule', false);
    }
  },

  updateSandboxRule: async (id, body) => {
    get()._setLoading('updateSandboxRule', true);
    try {
      const res = await api.sandbox.rules.update(id, body);
      set({ currentSandboxRule: res.data });
      await get().loadSandboxRules();
      get().addToast({ type: 'success', message: '规则已更新' });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '更新失败: ' + e.message });
    } finally {
      get()._setLoading('updateSandboxRule', false);
    }
  },

  deleteSandboxRule: async (id, operator) => {
    try {
      await api.sandbox.rules.delete(id, operator);
      get().addToast({ type: 'success', message: '规则已删除' });
      if (get().selectedSandboxRuleId === id) {
        set({ selectedSandboxRuleId: null, currentSandboxRule: null });
      }
      await get().loadSandboxRules();
    } catch (e: any) {
      get().addToast({ type: 'error', message: '删除失败: ' + e.message });
    }
  },

  copySandboxRule: async (id, newName, operator) => {
    try {
      const res = await api.sandbox.rules.copy(id, { newName, operator });
      get().addToast({ type: 'success', message: '规则已复制' });
      await get().loadSandboxRules();
      return res.data;
    } catch (e: any) {
      get().addToast({ type: 'error', message: '复制失败: ' + e.message });
      return null;
    }
  },

  undoSandboxRule: async (id, operator) => {
    try {
      const res = await api.sandbox.rules.undo(id, { operator });
      if (res.success) {
        get().addToast({ type: 'success', message: res.message || '已撤销最近一次修改' });
        if (res.data) {
          set({ currentSandboxRule: res.data });
        }
        await get().loadSandboxRules();
        await get().loadSandboxRuleHistory(id);
        return true;
      } else {
        get().addToast({ type: 'warning', message: res.message || '撤销失败' });
        return false;
      }
    } catch (e: any) {
      get().addToast({ type: 'error', message: '撤销失败: ' + e.message });
      return false;
    }
  },

  loadSandboxRuleHistory: async (id) => {
    try {
      const res = await api.sandbox.rules.history(id);
      set({ sandboxRuleHistory: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载历史失败: ' + e.message });
    }
  },

  selectSandboxRule: async (id) => {
    set({ selectedSandboxRuleId: id, selectedPlaybackId: null, currentPlayback: null, comparisonResult: null });
    if (id) {
      await Promise.all([
        get().loadSandboxRule(id),
        get().loadSandboxPlaybacks(id),
        get().loadSandboxRuleHistory(id),
      ]);
    }
    await get().persistSandboxState();
  },

  loadSandboxPlaybacks: async (ruleId) => {
    try {
      const res = await api.sandbox.rules.playbacks(ruleId);
      set({ sandboxPlaybacks: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载回放记录失败: ' + e.message });
    }
  },

  runPlaybackFromSensors: async (ruleId, body) => {
    get()._setLoading('playback', true);
    try {
      const res = await api.sandbox.rules.playbackSensors(ruleId, body);
      get().addToast({ type: 'success', message: '回放任务已启动' });
      await get().loadSandboxPlaybacks(ruleId);
      await get().selectPlayback(res.data.id);
    } catch (e: any) {
      get().addToast({ type: 'error', message: '回放失败: ' + e.message });
    } finally {
      get()._setLoading('playback', false);
    }
  },

  runPlaybackFromCsv: async (ruleId, file, name, operator) => {
    get()._setLoading('playback', true);
    try {
      const r = await api.sandbox.rules.playbackCsv(ruleId, file, name, operator);
      if (r.data.success) {
        get().addToast({ type: 'success', message: 'CSV 回放已完成' });
        await get().loadSandboxPlaybacks(ruleId);
        await get().selectPlayback(r.data.data.id);
      } else {
        get().addToast({ type: 'error', message: '回放失败: ' + (r.data.error || '未知错误') });
      }
    } catch (e: any) {
      get().addToast({ type: 'error', message: '回放失败: ' + e.message });
    } finally {
      get()._setLoading('playback', false);
    }
  },

  loadComparisonResult: async (playbackId) => {
    get()._setLoading('comparison', true);
    try {
      const res = await api.sandbox.playbacks.comparison(playbackId);
      set({ comparisonResult: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载对比结果失败: ' + e.message });
    } finally {
      get()._setLoading('comparison', false);
    }
  },

  loadSandboxAnomalies: async (playbackId, options) => {
    try {
      const res = await api.sandbox.playbacks.anomalies(playbackId, options);
      set({ sandboxAnomalies: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '加载异常明细失败: ' + e.message });
    }
  },

  selectPlayback: async (id) => {
    set({ selectedPlaybackId: id });
    if (id) {
      const [playbackRes] = await Promise.allSettled([
        api.sandbox.playbacks.get(id),
      ]);
      if (playbackRes.status === 'fulfilled') {
        set({ currentPlayback: playbackRes.value.data });
      }
      await Promise.all([
        get().loadComparisonResult(id),
        get().loadSandboxAnomalies(id),
      ]);
    }
    await get().persistSandboxState();
  },

  checkPublishConflict: async (ruleId) => {
    try {
      const res = await api.sandbox.rules.conflict(ruleId);
      set({ publishConflict: res.data });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '检查冲突失败: ' + e.message });
    }
  },

  publishSandboxRule: async (ruleId, options) => {
    try {
      const res = await api.sandbox.rules.publish(ruleId, options || {});
      if (res.success) {
        get().addToast({ type: 'success', message: '发布成功，正式阈值已更新' });
        await get().loadSandboxRules();
        await get().loadSandboxRule(ruleId);
        await get().loadThresholds();
        return true;
      } else if (res.conflict) {
        set({ publishConflict: res.conflict });
        get().addToast({ type: 'warning', message: '发布冲突：正式规则已被修改' });
        return false;
      }
      return false;
    } catch (e: any) {
      const msg = e.message || '发布失败';
      if (msg.includes('冲突')) {
        get().addToast({ type: 'warning', message: msg });
      } else {
        get().addToast({ type: 'error', message: msg });
      }
      return false;
    }
  },

  exportSandboxComparison: async (playbackId, operator) => {
    try {
      await api.sandbox.playbacks.exportCsv(playbackId, operator);
      get().addToast({ type: 'success', message: '对比报告导出成功' });
    } catch (e: any) {
      get().addToast({ type: 'error', message: '导出失败: ' + e.message });
    }
  },

  loadSandboxState: async () => {
    try {
      const res = await api.sandbox.state.get();
      set({ sandboxState: res.data });
      if (res.data.selectedSandboxId) {
        set({ selectedSandboxRuleId: res.data.selectedSandboxId });
      }
      if (res.data.selectedPlaybackId) {
        set({ selectedPlaybackId: res.data.selectedPlaybackId });
      }
    } catch { /* ignore */ }
  },

  persistSandboxState: async () => {
    try {
      const { selectedSandboxRuleId, selectedPlaybackId, sandboxState } = get();
      await api.sandbox.state.save({
        selectedSandboxId: selectedSandboxRuleId,
        selectedPlaybackId: selectedPlaybackId,
        filter: sandboxState?.filter || {},
        view: sandboxState?.view || {},
      });
    } catch { /* ignore */ }
  },

  deletePlayback: async (playbackId, operator) => {
    try {
      await api.sandbox.playbacks.delete(playbackId, operator);
      get().addToast({ type: 'success', message: '回放记录已删除' });
      if (get().selectedPlaybackId === playbackId) {
        set({ selectedPlaybackId: null, currentPlayback: null, comparisonResult: null, sandboxAnomalies: [] });
      }
      const ruleId = get().selectedSandboxRuleId;
      if (ruleId) await get().loadSandboxPlaybacks(ruleId);
    } catch (e: any) {
      get().addToast({ type: 'error', message: '删除失败: ' + e.message });
    }
  },
}));

export default useQCStore;

export interface Sensor {
  id: string;
  name: string;
  location: string;
  model: string;
  createdAt: string;
  readingCount?: number;
  anomalyCount?: number;
  pendingCount?: number;
}

export interface Reading {
  id: string;
  sensorId: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  batchId: string;
  rawRow?: number;
}

export type AnomalyType =
  | 'OVER_LIMIT_TEMP'
  | 'OVER_LIMIT_HUMID'
  | 'UNDER_LIMIT_TEMP'
  | 'UNDER_LIMIT_HUMID'
  | 'DRIFT_TEMP'
  | 'DRIFT_HUMID'
  | 'DATA_GAP';

export type AnnotationStatus =
  | 'DETECTED'
  | 'PENDING'
  | 'ACCEPTED'
  | 'FALSE_POSITIVE'
  | 'RETEST';

export interface Anomaly {
  id: string;
  readingId: string;
  sensorId: string;
  sensorName?: string;
  type: AnomalyType;
  description: string;
  detectedAt: string;
  thresholdSnapshot: ThresholdConfig;
  hasManualOverride: number;
  reading?: Reading;
  latestAnnotation?: Annotation;
}

export interface Annotation {
  id: string;
  anomalyId: string;
  status: AnnotationStatus;
  handler: string;
  reason: string;
  createdAt: string;
  rolledBackAt: string | null;
  rollbackReason: string | null;
  anomalyType?: AnomalyType;
  sensorName?: string;
  timestamp?: string;
}

export interface ThresholdConfig {
  tempMin: number;
  tempMax: number;
  humidMin: number;
  humidMax: number;
  tempDriftThreshold: number;
  humidDriftThreshold: number;
  gapThresholdSeconds: number;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  fileHash: string;
  rowCount: number;
  sensorCount: number;
  importedAt: string;
  errorCount: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  field: string;
  value: string;
  message: string;
}

export interface ImportResponse {
  success: boolean;
  batchId: string;
  totalRows: number;
  validRows: number;
  sensorIds: string[];
  errors: ImportError[];
  duplicateBatch: boolean;
  existingBatchId?: string;
  message?: string;
}

export interface AppState {
  selectedSensorId: string | null;
  statusFilter: 'ALL' | AnnotationStatus;
  timeRange: 'ALL' | '1H' | '24H' | '7D' | 'CUSTOM';
  customStart?: string;
  customEnd?: string;
  view: object;
}

export interface ChartDataPoint {
  timestamp: string;
  temperature: number;
  humidity: number;
  anomalies: AnomalyType[];
}

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  OVER_LIMIT_TEMP: '温度越上限',
  OVER_LIMIT_HUMID: '湿度越上限',
  UNDER_LIMIT_TEMP: '温度越下限',
  UNDER_LIMIT_HUMID: '湿度越下限',
  DRIFT_TEMP: '温度漂移',
  DRIFT_HUMID: '湿度漂移',
  DATA_GAP: '数据断点',
};

export const ANOMALY_TYPE_COLORS: Record<AnomalyType, string> = {
  OVER_LIMIT_TEMP: '#EF4444',
  OVER_LIMIT_HUMID: '#F97316',
  UNDER_LIMIT_TEMP: '#8B5CF6',
  UNDER_LIMIT_HUMID: '#EC4899',
  DRIFT_TEMP: '#F59E0B',
  DRIFT_HUMID: '#EAB308',
  DATA_GAP: '#6366F1',
};

export const STATUS_LABELS: Record<AnnotationStatus, string> = {
  DETECTED: '待处理',
  PENDING: '待确认',
  ACCEPTED: '已接受',
  FALSE_POSITIVE: '误报',
  RETEST: '需复测',
};

export const STATUS_COLORS: Record<AnnotationStatus, string> = {
  DETECTED: '#EF4444',
  PENDING: '#F59E0B',
  ACCEPTED: '#10B981',
  FALSE_POSITIVE: '#6B7280',
  RETEST: '#3B82F6',
};

export type AuditAction =
  | 'ANNOTATE_CREATE'
  | 'ANNOTATE_ROLLBACK'
  | 'THRESHOLD_UPDATE'
  | 'IMPORT_BATCH'
  | 'ANOMALY_DETECT'
  | 'STATE_SAVE'
  | 'REPORT_EXPORT';

export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  operator: string;
  beforeJson?: any;
  afterJson?: any;
  before?: any;
  after?: any;
  detail?: string;
  createdAt: string;
}

export interface ThresholdPreviewResult {
  affectedSensors: {
    sensorId: string;
    sensorName: string;
    currentCount: number;
    newCount: number;
    delta: number;
  }[];
  byType: {
    type: string;
    currentCount: number;
    newCount: number;
    delta: number;
  }[];
  summary: {
    currentTotal: number;
    newTotal: number;
    delta: number;
    addedCount: number;
    removedCount: number;
    protectedCount: number;
    totalReadings: number;
  };
}

export type WorkOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type WorkOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED';
export type WorkOrderAction = 'CREATE' | 'REASSIGN' | 'CLOSE' | 'REOPEN' | 'UPDATE' | 'CANCEL';

export interface WorkOrder {
  id: string;
  anomalyId: string;
  anomaly?: Anomaly;
  title: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assignee: string;
  creator: string;
  deadline?: string;
  remark?: string;
  closedAt?: string;
  closedBy?: string;
  closeReason?: string;
  canReopen: number;
  createdAt: string;
  updatedAt: string;
  latestHistory?: WorkOrderHistory;
}

export interface WorkOrderHistory {
  id: string;
  workOrderId: string;
  action: WorkOrderAction;
  operator: string;
  beforeJson?: any;
  afterJson?: any;
  detail?: string;
  createdAt: string;
}

export interface WorkOrderFilter {
  assignee?: string;
  status?: WorkOrderStatus | 'ALL';
  sensorId?: string;
  priority?: WorkOrderPriority | 'ALL';
}

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  LOW: '低',
  NORMAL: '普通',
  HIGH: '高',
  URGENT: '紧急',
};

export const WORK_ORDER_PRIORITY_COLORS: Record<WorkOrderPriority, string> = {
  LOW: '#6B7280',
  NORMAL: '#3B82F6',
  HIGH: '#F59E0B',
  URGENT: '#EF4444',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};

export const WORK_ORDER_STATUS_COLORS: Record<WorkOrderStatus, string> = {
  PENDING: '#F59E0B',
  IN_PROGRESS: '#3B82F6',
  CLOSED: '#10B981',
  CANCELLED: '#6B7280',
};

export const WORK_ORDER_ACTION_LABELS: Record<WorkOrderAction, string> = {
  CREATE: '创建工单',
  REASSIGN: '改派处理人',
  CLOSE: '关闭工单',
  REOPEN: '撤销关闭',
  UPDATE: '更新信息',
  CANCEL: '取消工单',
};

export type SandboxRuleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type SandboxPlaybackStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type SandboxPlaybackSourceType = 'CSV_UPLOAD' | 'SENSOR_RANGE' | 'SAMPLE_DATA';

export interface SandboxRule {
  id: string;
  name: string;
  description?: string;
  status: SandboxRuleStatus;
  threshold: ThresholdConfig;
  sourceRuleId?: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  baseVersionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxPlayback {
  id: string;
  sandboxRuleId: string;
  name: string;
  sourceType: SandboxPlaybackSourceType;
  sourceMeta?: any;
  status: SandboxPlaybackStatus;
  sensorIds?: string[];
  timeStart?: string;
  timeEnd?: string;
  totalReadings: number;
  anomalyCount: number;
  result?: any;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface SandboxAnomaly {
  id: string;
  playbackId: string;
  sandboxRuleId: string;
  sensorId: string;
  readingId?: string;
  type: AnomalyType;
  description: string;
  readingTimestamp: string;
  temperature?: number;
  humidity?: number;
  isNewComparedToLive: number;
  isMissingComparedToLive: number;
  createdAt: string;
}

export interface SandboxComparisonResult {
  summary: {
    liveTotal: number;
    sandboxTotal: number;
    newCount: number;
    missingCount: number;
    commonCount: number;
    delta: number;
  };
  bySensor: {
    sensorId: string;
    sensorName: string;
    liveCount: number;
    sandboxCount: number;
    newCount: number;
    missingCount: number;
    delta: number;
  }[];
  byType: {
    type: string;
    liveCount: number;
    sandboxCount: number;
    newCount: number;
    missingCount: number;
    delta: number;
  }[];
  newAnomalies: SandboxAnomaly[];
  missingAnomalies: SandboxAnomaly[];
}

export interface SandboxState {
  filter: any;
  view: any;
  selectedSandboxId: string | null;
  selectedPlaybackId: string | null;
}

export interface PublishConflictInfo {
  hasConflict: boolean;
  liveThreshold: ThresholdConfig;
  sandboxThreshold: ThresholdConfig;
  lastLiveUpdateAt: string;
  sandboxBaseVersionAt?: string;
  differences: {
    field: string;
    liveValue: number;
    sandboxValue: number;
  }[];
}

declare module './types' {
  interface AppState {
    workOrderFilter?: WorkOrderFilter;
    workOrderView?: object;
  }
}

import { useState, useEffect, useRef, useCallback } from 'react';
import useQCStore from '@/store';
import type { ThresholdConfig, ThresholdPreviewResult, AuditLog } from '../../shared/types.js';
import { X, Thermometer, Droplets, TrendingUp, Clock, Shield, Save, AlertTriangle, RotateCcw, Eye, History, User, BarChart3, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const ANOMALY_LABELS: Record<string, string> = {
  OVER_LIMIT_TEMP: '温度越上限',
  OVER_LIMIT_HUMID: '湿度越上限',
  UNDER_LIMIT_TEMP: '温度越下限',
  UNDER_LIMIT_HUMID: '湿度越下限',
  DRIFT_TEMP: '温度漂移',
  DRIFT_HUMID: '湿度漂移',
  DATA_GAP: '数据断点',
};

export default function ThresholdDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const thresholds = useQCStore((s) => s.thresholds);
  const update = useQCStore((s) => s.updateThresholds);
  const preview = useQCStore((s) => s.previewThresholds);
  const clearPreview = useQCStore((s) => s.clearThresholdPreview);
  const previewResult = useQCStore((s) => s.thresholdPreview);
  const thresholdHistory = useQCStore((s) => s.thresholdHistory);
  const loadHistory = useQCStore((s) => s.loadThresholdHistory);
  const loading = useQCStore((s) => s.loading.thresholds);
  const previewLoading = useQCStore((s) => s.loading.thresholdPreview);

  const [form, setForm] = useState<ThresholdConfig>(thresholds);
  const [dirty, setDirty] = useState(false);
  const [operator, setOperator] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'history'>('preview');
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const errors: Record<string, string> = {};
  if (form.tempMin >= form.tempMax) errors.temp = '温度下限必须小于上限';
  if (form.humidMin >= form.humidMax) errors.humid = '湿度下限必须小于上限';
  if (form.tempDriftThreshold < 0) errors.tempDrift = '漂移阈值不能为负';
  if (form.humidDriftThreshold < 0) errors.humidDrift = '漂移阈值不能为负';
  if (form.gapThresholdSeconds < 1) errors.gap = '断点阈值最少1秒';
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (open) {
      setForm(thresholds);
      setDirty(false);
      setOperator('');
      setActiveTab('preview');
      clearPreview();
      loadHistory();
    }
  }, [open, thresholds, clearPreview, loadHistory]);

  const runPreview = useCallback(async (cfg: ThresholdConfig) => {
    if (cfg.tempMin >= cfg.tempMax) return;
    if (cfg.humidMin >= cfg.humidMax) return;
    if (cfg.tempDriftThreshold < 0) return;
    if (cfg.humidDriftThreshold < 0) return;
    if (cfg.gapThresholdSeconds < 1) return;
    await preview(cfg);
  }, [preview]);

  const debouncedPreview = useCallback((cfg: ThresholdConfig) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      runPreview(cfg);
    }, 400);
  }, [runPreview]);

  useEffect(() => {
    if (dirty && !hasErrors) {
      debouncedPreview(form);
    }
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [form, dirty, hasErrors, debouncedPreview]);

  const updateField = <K extends keyof ThresholdConfig>(k: K, v: number) => {
    const newForm = { ...form, [k]: v };
    setForm(newForm);
    setDirty(true);
  };

  const reset = () => {
    const defaults: ThresholdConfig = {
      tempMin: 15, tempMax: 30, humidMin: 30, humidMax: 70,
      tempDriftThreshold: 2, humidDriftThreshold: 10, gapThresholdSeconds: 600,
    };
    setForm(defaults);
    setDirty(true);
  };

  const submit = async () => {
    if (hasErrors || !operator.trim()) return;
    await update({ ...form, operator: operator.trim() });
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slateqc-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slateqc-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
          <div>
            <h2 className="font-bold text-slateqc-900 text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent-blue" />
              阈值配置
            </h2>
            <p className="text-xs text-slateqc-500 mt-0.5">
              修改后将自动重新检测所有异常，已有人工结论的记录保持不变
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !p-2 rounded-full hover:bg-slateqc-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/2 p-6 overflow-y-auto scrollbar-thin border-r border-slateqc-100 space-y-5">
            <div className="grid grid-cols-1 gap-4">
              <SectionCard
                title="温度范围"
                icon={<Thermometer className="w-4 h-4" />}
                accent="#F97316"
                unit="℃"
                error={errors.temp}
              >
                <RangeInput
                  label="下限"
                  value={form.tempMin}
                  onChange={(v) => updateField('tempMin', v)}
                  step={0.1}
                  accent="#F97316"
                  unit="℃"
                />
                <RangeInput
                  label="上限"
                  value={form.tempMax}
                  onChange={(v) => updateField('tempMax', v)}
                  step={0.1}
                  accent="#F97316"
                  unit="℃"
                />
              </SectionCard>

              <SectionCard
                title="湿度范围"
                icon={<Droplets className="w-4 h-4" />}
                accent="#06B6D4"
                unit="%"
                error={errors.humid}
              >
                <RangeInput
                  label="下限"
                  value={form.humidMin}
                  onChange={(v) => updateField('humidMin', v)}
                  step={1}
                  accent="#06B6D4"
                  unit="%"
                />
                <RangeInput
                  label="上限"
                  value={form.humidMax}
                  onChange={(v) => updateField('humidMax', v)}
                  step={1}
                  accent="#06B6D4"
                  unit="%"
                />
              </SectionCard>

              <SectionCard
                title="漂移阈值（相邻变化幅度）"
                icon={<TrendingUp className="w-4 h-4" />}
                accent="#F59E0B"
                error={errors.tempDrift || errors.humidDrift}
              >
                <RangeInput
                  label="温度"
                  value={form.tempDriftThreshold}
                  onChange={(v) => updateField('tempDriftThreshold', v)}
                  step={0.1}
                  accent="#F59E0B"
                  unit="℃"
                  hint="相邻两次读数相差超过即触发"
                />
                <RangeInput
                  label="湿度"
                  value={form.humidDriftThreshold}
                  onChange={(v) => updateField('humidDriftThreshold', v)}
                  step={1}
                  accent="#F59E0B"
                  unit="%"
                />
              </SectionCard>

              <SectionCard
                title="数据断点阈值"
                icon={<Clock className="w-4 h-4" />}
                accent="#6366F1"
                error={errors.gap}
              >
                <RangeInput
                  label="时间间隔"
                  value={form.gapThresholdSeconds}
                  onChange={(v) => updateField('gapThresholdSeconds', v)}
                  step={60}
                  accent="#6366F1"
                  unit="秒"
                  hint={`超过此时间视为断点（约 ${(form.gapThresholdSeconds / 60).toFixed(1)} 分钟）`}
                />
              </SectionCard>
            </div>

            <div className="p-4 rounded-2xl border-2 border-slateqc-100 bg-white">
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-slateqc-500" />
                <h4 className="text-sm font-bold text-slateqc-800">操作者</h4>
              </div>
              <input
                type="text"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="请输入您的姓名或工号"
                className="input-field w-full"
                maxLength={50}
              />
              {!operator.trim() && dirty && (
                <p className="text-[11px] text-accent-red mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  保存前请填写操作者信息
                </p>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-accent-amber shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 space-y-1">
                <p className="font-semibold">保存后将立即重算所有异常</p>
                <ul className="list-disc list-inside space-y-0.5 text-amber-700/80">
                  <li>仅对未人工标注的异常重新检测</li>
                  <li>已有标注记录（含回滚前）的异常将保持不变</li>
                  <li>修改阈值建议先缩小范围观察效果</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex border-b border-slateqc-100">
              <button
                onClick={() => setActiveTab('preview')}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  activeTab === 'preview'
                    ? 'text-accent-blue border-b-2 border-accent-blue bg-blue-50/50'
                    : 'text-slateqc-500 hover:text-slateqc-700 hover:bg-slateqc-50'
                )}
              >
                <Eye className="w-4 h-4" />
                变更预览
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  activeTab === 'history'
                    ? 'text-accent-blue border-b-2 border-accent-blue bg-blue-50/50'
                    : 'text-slateqc-500 hover:text-slateqc-700 hover:bg-slateqc-50'
                )}
              >
                <History className="w-4 h-4" />
                变更历史
                {thresholdHistory.length > 0 && (
                  <span className="bg-slateqc-200 text-slateqc-600 text-xs px-1.5 py-0.5 rounded-full">
                    {thresholdHistory.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
              {activeTab === 'preview' && (
                <PreviewPanel
                  preview={previewResult}
                  loading={previewLoading}
                  dirty={dirty}
                  hasErrors={hasErrors}
                />
              )}
              {activeTab === 'history' && (
                <HistoryPanel history={thresholdHistory} />
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slateqc-100 bg-slateqc-50/50 flex items-center justify-between gap-3">
          <button
            onClick={reset}
            className="btn-ghost text-slateqc-500"
          >
            <RotateCcw className="w-4 h-4" />
            恢复默认
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button
              onClick={() => void submit()}
              disabled={loading || hasErrors || !dirty || !operator.trim()}
              className="btn-primary"
            >
              {loading ? (
                <>
                  <RotateCcw className="w-4 h-4 animate-spin" />
                  重算中...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  保存并重算
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  preview, loading, dirty, hasErrors,
}: {
  preview: ThresholdPreviewResult | null;
  loading: boolean;
  dirty: boolean;
  hasErrors: boolean;
}) {
  if (!dirty) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-slateqc-100 flex items-center justify-center mb-4">
          <Eye className="w-8 h-8 text-slateqc-400" />
        </div>
        <h3 className="font-semibold text-slateqc-700 mb-1">调整阈值后即可预览</h3>
        <p className="text-sm text-slateqc-500">
          修改左侧阈值配置后，系统会自动计算本次调整对异常检测的影响
        </p>
      </div>
    );
  }

  if (hasErrors) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-accent-red" />
        </div>
        <h3 className="font-semibold text-slateqc-700 mb-1">请先修正配置错误</h3>
        <p className="text-sm text-slateqc-500">
          左侧有红色提示的配置项需要调整后才能预览
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
          <RotateCcw className="w-8 h-8 text-accent-blue animate-spin" />
        </div>
        <h3 className="font-semibold text-slateqc-700 mb-1">正在计算影响范围...</h3>
        <p className="text-sm text-slateqc-500">
          基于当前数据库中的读数数据进行模拟检测
        </p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-slateqc-100 flex items-center justify-center mb-4">
          <BarChart3 className="w-8 h-8 text-slateqc-400" />
        </div>
        <h3 className="font-semibold text-slateqc-700 mb-1">等待预览结果</h3>
        <p className="text-sm text-slateqc-500">
          系统正在准备预览数据...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="当前异常数"
          value={preview.summary.currentTotal}
          icon={<Activity className="w-4 h-4" />}
          accent="#6B7280"
        />
        <StatCard
          label="预计异常数"
          value={preview.summary.newTotal}
          icon={<BarChart3 className="w-4 h-4" />}
          accent={preview.summary.delta > 0 ? '#EF4444' : preview.summary.delta < 0 ? '#10B981' : '#6B7280'}
          delta={preview.summary.delta}
        />
        <StatCard
          label="预计新增"
          value={preview.summary.addedCount}
          icon={<TrendingUp className="w-4 h-4" />}
          accent="#F59E0B"
        />
        <StatCard
          label="预计减少"
          value={preview.summary.removedCount}
          icon={<TrendingUp className="w-4 h-4 rotate-180" />}
          accent="#06B6D4"
        />
      </div>

      <div className="p-3 rounded-xl bg-slateqc-50 border border-slateqc-100 flex items-center justify-between text-xs">
        <span className="text-slateqc-500">受保护的人工标注</span>
        <span className="font-bold text-slateqc-700">{preview.summary.protectedCount} 条</span>
      </div>

      {preview.affectedSensors.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slateqc-700 mb-2 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            受影响的传感器
          </h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {preview.affectedSensors.slice(0, 10).map((s) => (
              <div
                key={s.sensorId}
                className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slateqc-100"
              >
                <div>
                  <p className="text-sm font-medium text-slateqc-800">{s.sensorName}</p>
                  <p className="text-xs text-slateqc-500">
                    {s.currentCount} → {s.newCount}
                  </p>
                </div>
                <span className={cn(
                  'text-xs font-bold px-2 py-1 rounded-lg',
                  s.delta > 0
                    ? 'bg-red-100 text-accent-red'
                    : 'bg-green-100 text-green-600'
                )}>
                  {s.delta > 0 ? '+' : ''}{s.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.byType.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slateqc-700 mb-2 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            按异常类型统计
          </h4>
          <div className="space-y-2">
            {preview.byType.map((t) => (
              <div
                key={t.type}
                className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slateqc-100"
              >
                <div>
                  <p className="text-sm font-medium text-slateqc-800">
                    {ANOMALY_LABELS[t.type] || t.type}
                  </p>
                  <p className="text-xs text-slateqc-500">
                    {t.currentCount} → {t.newCount}
                  </p>
                </div>
                <span className={cn(
                  'text-xs font-bold px-2 py-1 rounded-lg',
                  t.delta > 0
                    ? 'bg-red-100 text-accent-red'
                    : t.delta < 0
                      ? 'bg-green-100 text-green-600'
                      : 'bg-slateqc-100 text-slateqc-500'
                )}>
                  {t.delta > 0 ? '+' : ''}{t.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.affectedSensors.length === 0 && preview.summary.delta === 0 && (
        <div className="p-6 rounded-xl bg-green-50 border border-green-100 text-center">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
            <Shield className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-sm font-medium text-green-700">本次调整不影响现有异常</p>
          <p className="text-xs text-green-600 mt-1">阈值变化未达到影响检测结果的程度</p>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ history }: { history: AuditLog[] }) {
  if (history.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-slateqc-100 flex items-center justify-center mb-4">
          <History className="w-8 h-8 text-slateqc-400" />
        </div>
        <h3 className="font-semibold text-slateqc-700 mb-1">暂无变更记录</h3>
        <p className="text-sm text-slateqc-500">
          保存阈值配置后，变更记录将显示在这里
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((log, idx) => (
        <div
          key={log.id}
          className={cn(
            'p-4 rounded-xl border transition-all',
            idx === 0
              ? 'bg-blue-50 border-blue-200'
              : 'bg-white border-slateqc-100'
          )}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center',
                idx === 0 ? 'bg-blue-200 text-blue-700' : 'bg-slateqc-100 text-slateqc-500'
              )}>
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slateqc-800">
                  {log.operator}
                </p>
                <p className="text-xs text-slateqc-500">
                  {new Date(log.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
            {idx === 0 && (
              <span className="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                当前生效
              </span>
            )}
          </div>

          {log.beforeJson && log.afterJson && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-red-50 border border-red-100">
                <p className="text-red-600 font-medium mb-1">变更前</p>
                <div className="space-y-0.5 text-red-700/80">
                  <p>温度: {log.beforeJson.tempMin}~{log.beforeJson.tempMax}℃</p>
                  <p>湿度: {log.beforeJson.humidMin}~{log.beforeJson.humidMax}%</p>
                  <p>漂移: 温{log.beforeJson.tempDriftThreshold}℃ / 湿{log.beforeJson.humidDriftThreshold}%</p>
                  <p>断点: {log.beforeJson.gapThresholdSeconds}秒</p>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-green-100">
                <p className="text-green-600 font-medium mb-1">变更后</p>
                <div className="space-y-0.5 text-green-700/80">
                  <p>温度: {log.afterJson.tempMin}~{log.afterJson.tempMax}℃</p>
                  <p>湿度: {log.afterJson.humidMin}~{log.afterJson.humidMax}%</p>
                  <p>漂移: 温{log.afterJson.tempDriftThreshold}℃ / 湿{log.afterJson.humidDriftThreshold}%</p>
                  <p>断点: {log.afterJson.gapThresholdSeconds}秒</p>
                </div>
              </div>
            </div>
          )}

          {log.detail && (
            <p className="text-xs text-slateqc-600 mt-2 pt-2 border-t border-slateqc-100">
              {log.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label, value, icon, accent, delta,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  delta?: number;
}) {
  return (
    <div className="p-3 rounded-xl bg-white border border-slateqc-100">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: accent + '20', color: accent }}
        >
          {icon}
        </div>
        <span className="text-xs text-slateqc-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold" style={{ color: accent }}>
          {value}
        </span>
        {delta !== undefined && delta !== 0 && (
          <span className={cn(
            'text-xs font-bold',
            delta > 0 ? 'text-accent-red' : 'text-green-600'
          )}>
            ({delta > 0 ? '+' : ''}{delta})
          </span>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  title, icon, accent, error, children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  unit?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'p-4 rounded-2xl border-2 bg-white transition-all',
        error ? 'border-accent-red/50 bg-red-50/40' : 'border-slateqc-100',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: accent + '15', color: accent }}
        >
          {icon}
        </div>
        <h4 className="text-sm font-bold text-slateqc-800">{title}</h4>
      </div>
      <div className="space-y-2.5">{children}</div>
      {error && (
        <p className="text-[11px] text-accent-red mt-2.5 font-medium flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

function RangeInput({
  label, value, onChange, step, accent, unit, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  accent: string;
  unit: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-slateqc-600">{label}</label>
        <div
          className="font-mono text-sm font-bold px-2 py-0.5 rounded"
          style={{ background: accent + '15', color: accent }}
        >
          {Number(value).toFixed(step < 1 ? 1 : 0)} {unit}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Number((value - step).toFixed(step < 1 ? 1 : 0)))}
          className="w-8 h-8 rounded-lg bg-slateqc-50 border border-slateqc-200 hover:bg-slateqc-100 font-bold text-slateqc-600 shrink-0 transition-colors"
        >
          −
        </button>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="input-field !py-1.5 !text-center font-mono"
        />
        <button
          onClick={() => onChange(Number((value + step).toFixed(step < 1 ? 1 : 0)))}
          className="w-8 h-8 rounded-lg bg-slateqc-50 border border-slateqc-200 hover:bg-slateqc-100 font-bold text-slateqc-600 shrink-0 transition-colors"
        >
          +
        </button>
      </div>
      {hint && <p className="text-[10px] text-slateqc-400 mt-1">{hint}</p>}
    </div>
  );
}

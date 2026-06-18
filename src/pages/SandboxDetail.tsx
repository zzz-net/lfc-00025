import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useQCStore from '@/store';
import {
  ArrowLeft, Play, Upload, FileSpreadsheet, Trash2, Edit3, Save,
  AlertTriangle, CheckCircle, Clock, Settings, BarChart3, List,
  ChevronDown, ChevronUp, RefreshCw, Share2, Undo2, ShieldAlert, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ANOMALY_TYPE_LABELS, ANOMALY_TYPE_COLORS, STATUS_LABELS, STATUS_COLORS,
} from '../../shared/types.js';
import type { ThresholdConfig, SandboxAnomaly, AnnotationStatus } from '../../shared/types.js';

const THRESHOLD_FIELDS: Array<{ key: keyof ThresholdConfig; label: string; unit: string; category: string }> = [
  { key: 'tempMin', label: '温度下限', unit: '℃', category: '温度' },
  { key: 'tempMax', label: '温度上限', unit: '℃', category: '温度' },
  { key: 'humidMin', label: '湿度下限', unit: '%RH', category: '湿度' },
  { key: 'humidMax', label: '湿度上限', unit: '%RH', category: '湿度' },
  { key: 'tempDriftThreshold', label: '温度漂移阈值', unit: '℃', category: '漂移' },
  { key: 'humidDriftThreshold', label: '湿度漂移阈值', unit: '%RH', category: '漂移' },
  { key: 'gapThresholdSeconds', label: '数据断点阈值', unit: '秒', category: '断点' },
];

export default function SandboxDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentRule = useQCStore((s) => s.currentSandboxRule);
  const sandboxPlaybacks = useQCStore((s) => s.sandboxPlaybacks);
  const selectedPlaybackId = useQCStore((s) => s.selectedPlaybackId);
  const currentPlayback = useQCStore((s) => s.currentPlayback);
  const comparisonResult = useQCStore((s) => s.comparisonResult);
  const sandboxAnomalies = useQCStore((s) => s.sandboxAnomalies);
  const publishConflict = useQCStore((s) => s.publishConflict);
  const sandboxRuleHistory = useQCStore((s) => s.sandboxRuleHistory);
  const sandboxState = useQCStore((s) => s.sandboxState);
  const loading = useQCStore((s) => s.loading);

  const loadSandboxRule = useQCStore((s) => s.loadSandboxRule);
  const loadSandboxPlaybacks = useQCStore((s) => s.loadSandboxPlaybacks);
  const updateSandboxRule = useQCStore((s) => s.updateSandboxRule);
  const runPlaybackFromSensors = useQCStore((s) => s.runPlaybackFromSensors);
  const runPlaybackFromCsv = useQCStore((s) => s.runPlaybackFromCsv);
  const selectPlayback = useQCStore((s) => s.selectPlayback);
  const checkPublishConflict = useQCStore((s) => s.checkPublishConflict);
  const publishSandboxRule = useQCStore((s) => s.publishSandboxRule);
  const exportSandboxComparison = useQCStore((s) => s.exportSandboxComparison);
  const deletePlayback = useQCStore((s) => s.deletePlayback);
  const undoSandboxRule = useQCStore((s) => s.undoSandboxRule);
  const loadSandboxState = useQCStore((s) => s.loadSandboxState);
  const addToast = useQCStore((s) => s.addToast);
  const sensors = useQCStore((s) => s.sensors);
  const loadSensors = useQCStore((s) => s.loadSensors);

  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<ThresholdConfig | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [operator, setOperator] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'anomalies' | 'fp'>('overview');
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'new' | 'missing'>('all');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [timeRange, setTimeRange] = useState<'ALL' | '7D' | '24H' | 'CUSTOM'>('ALL');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    const savedOp = localStorage.getItem('qc_operator');
    if (savedOp) setOperator(savedOp);
    void loadSandboxState();
  }, []);

  useEffect(() => {
    if (id) {
      void loadSandboxRule(id);
      void loadSandboxPlaybacks(id);
      void loadSensors();
    }
  }, [id]);

  useEffect(() => {
    if (currentRule) {
      setRuleName(currentRule.name);
      setRuleDesc(currentRule.description || '');
      setEditValues(currentRule.threshold);
    }
  }, [currentRule]);

  useEffect(() => {
    if (sandboxState?.selectedPlaybackId && !selectedPlaybackId && sandboxPlaybacks.length > 0) {
      const saved = sandboxPlaybacks.find((p) => p.id === sandboxState.selectedPlaybackId);
      if (saved) void selectPlayback(saved.id);
    }
  }, [sandboxPlaybacks, sandboxState]);

  const startEditing = () => {
    if (currentRule) {
      setEditValues({ ...currentRule.threshold });
      setEditing(true);
    }
  };

  const saveEdits = async () => {
    if (!id || !editValues) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    await updateSandboxRule(id, {
      name: ruleName.trim(),
      description: ruleDesc.trim(),
      threshold: editValues,
      operator: op,
    });
    setEditing(false);
  };

  const handleUndo = async () => {
    if (!id) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    if (!confirm('确定要撤销最近一次修改吗？撤销后的状态也会被记录，可以再次撤销。')) return;
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    await undoSandboxRule(id, op);
  };

  const handleRunSensorPlayback = async () => {
    if (!id) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);

    let start: string | undefined;
    let end: string | undefined;
    if (timeRange === 'CUSTOM') {
      start = customStart ? new Date(customStart).toISOString() : undefined;
      end = customEnd ? new Date(customEnd).toISOString() : undefined;
    } else if (timeRange !== 'ALL') {
      const now = Date.now();
      const ms = timeRange === '24H' ? 86400_000 : 7 * 86400_000;
      start = new Date(now - ms).toISOString();
    }

    await runPlaybackFromSensors(id, {
      name: `传感器回放 - ${new Date().toLocaleString('zh-CN')}`,
      sensorIds: sensors.map((s) => s.id),
      timeStart: start,
      timeEnd: end,
      operator: op,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      e.target.value = '';
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    await runPlaybackFromCsv(id, file, file.name, op);
    e.target.value = '';
  };

  const handleCheckPublish = async () => {
    if (!id) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    await checkPublishConflict(id);
    setShowPublishDialog(true);
  };

  const handlePublish = async (force = false) => {
    if (!id) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    const success = await publishSandboxRule(id, { force, operator: op });
    if (success) {
      setShowPublishDialog(false);
    }
  };

  const handleExport = () => {
    if (!selectedPlaybackId) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    void exportSandboxComparison(selectedPlaybackId, op);
  };

  const handleDeletePlayback = async (playbackId: string) => {
    if (!confirm('确定要删除这条回放记录吗？')) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    await deletePlayback(playbackId, op);
  };

  const filteredAnomalies = sandboxAnomalies.filter((a) => {
    if (anomalyFilter === 'new') return a.isNewComparedToLive === 1;
    if (anomalyFilter === 'missing') return a.isMissingComparedToLive === 1;
    return true;
  });

  if (!currentRule) {
    return (
      <div className="min-h-screen bg-slateqc-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-slateqc-300 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slateqc-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slateqc-50">
      <header className="h-16 shrink-0 bg-white/80 backdrop-blur border-b border-slateqc-100 flex items-center px-6 gap-4 sticky top-0 z-40">
        <button onClick={() => navigate('/sandbox')} className="text-sm text-slateqc-500 hover:text-slateqc-700 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
        <div className="h-6 w-px bg-slateqc-200" />

        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              className="text-lg font-bold text-slateqc-900 bg-transparent border-b border-dashed border-slateqc-300 focus:outline-none focus:border-accent-blue w-80"
            />
          ) : (
            <h1 className="text-lg font-bold text-slateqc-900 truncate">{currentRule.name}</h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="请输入操作人 *"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className={cn(
              'w-32 px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2',
              operator.trim()
                ? 'border-slateqc-200 focus:ring-accent-blue/30'
                : 'border-red-300 bg-red-50 focus:ring-red-300/30',
            )}
          />

          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="btn-secondary text-xs">取消</button>
              <button
                onClick={saveEdits}
                className={cn(
                  'btn-primary text-xs flex items-center gap-1.5',
                  !operator.trim() && 'opacity-50 cursor-not-allowed',
                )}
                disabled={!operator.trim()}
              >
                <Save className="w-3.5 h-3.5" />
                保存
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleUndo}
                className={cn(
                  'btn-secondary text-xs flex items-center gap-1.5',
                  sandboxRuleHistory.length === 0 && 'opacity-50 cursor-not-allowed',
                )}
                disabled={sandboxRuleHistory.length === 0 || !operator.trim()}
                title={sandboxRuleHistory.length === 0 ? '暂无修改历史' : '撤销最近一次修改'}
              >
                <Undo2 className="w-3.5 h-3.5" />
                撤销
              </button>
              <button
                onClick={startEditing}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                编辑规则
              </button>
              <button
                onClick={handleCheckPublish}
                className={cn(
                  'btn-primary text-xs flex items-center gap-1.5',
                  !operator.trim() && 'opacity-50 cursor-not-allowed',
                )}
                disabled={!operator.trim()}
              >
                <Share2 className="w-3.5 h-3.5" />
                发布
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex">
        <aside className="w-72 shrink-0 border-r border-slateqc-100 bg-white min-h-[calc(100vh-4rem)] p-4">
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-slateqc-500 uppercase tracking-wider mb-3">阈值参数</h3>
            <div className="space-y-2">
              {THRESHOLD_FIELDS.map((field) => {
                const value = editing ? editValues?.[field.key] : currentRule.threshold[field.key];
                return (
                  <div key={String(field.key)} className="flex items-center justify-between text-sm">
                    <span className="text-slateqc-600 text-xs">{field.label}</span>
                    {editing ? (
                      <input
                        type="number"
                        value={value ?? 0}
                        onChange={(e) => setEditValues((prev) => prev ? { ...prev, [field.key]: Number(e.target.value) } : prev)}
                        className="w-20 px-2 py-1 text-xs text-right border border-slateqc-200 rounded focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                      />
                    ) : (
                      <span className="font-mono text-slateqc-900 text-xs">
                        {value} <span className="text-slateqc-400">{field.unit}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-xs font-semibold text-slateqc-500 uppercase tracking-wider mb-3">运行回放</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                {(['ALL', '24H', '7D', 'CUSTOM'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className={cn(
                      'flex-1 text-[10px] py-1.5 rounded-md font-medium transition-colors',
                      timeRange === r
                        ? 'bg-accent-blue text-white'
                        : 'bg-slateqc-50 text-slateqc-600 hover:bg-slateqc-100',
                    )}
                  >
                    {r === 'ALL' ? '全部' : r === 'CUSTOM' ? '自定义' : r}
                  </button>
                ))}
              </div>
              {timeRange === 'CUSTOM' && (
                <div className="space-y-1.5 mb-2">
                  <input
                    type="datetime-local"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-slateqc-200 rounded-lg"
                    placeholder="开始时间"
                  />
                  <input
                    type="datetime-local"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-slateqc-200 rounded-lg"
                    placeholder="结束时间"
                  />
                </div>
              )}
              <button
                onClick={handleRunSensorPlayback}
                className="w-full btn-secondary text-xs flex items-center justify-center gap-1.5"
                disabled={loading.playback}
              >
                {loading.playback ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                使用现有传感器数据回放
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full btn-secondary text-xs flex items-center justify-center gap-1.5"
                disabled={loading.playback}
              >
                <Upload className="w-3.5 h-3.5" />
                上传 CSV 回放
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slateqc-500 uppercase tracking-wider mb-3">回放历史</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {sandboxPlaybacks.map((pb) => (
                <div
                  key={pb.id}
                  onClick={() => void selectPlayback(pb.id)}
                  className={cn(
                    'p-3 rounded-lg border cursor-pointer transition-colors',
                    selectedPlaybackId === pb.id
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-slateqc-100 hover:border-slateqc-200 bg-white',
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slateqc-800 truncate flex-1">{pb.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDeletePlayback(pb.id); }}
                      className="text-slateqc-400 hover:text-red-500 ml-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slateqc-500">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded',
                      pb.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                      pb.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700',
                    )}>
                      {pb.status === 'COMPLETED' ? '完成' : pb.status === 'FAILED' ? '失败' : pb.status}
                    </span>
                    <span>{pb.totalReadings}条数据</span>
                  </div>
                  <div className="text-[10px] text-slateqc-400 mt-1">
                    {new Date(pb.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))}
              {sandboxPlaybacks.length === 0 && (
                <p className="text-xs text-slateqc-400 text-center py-4">暂无回放记录</p>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 p-6">
          {!currentPlayback || !comparisonResult ? (
            <div className="h-96 flex flex-col items-center justify-center">
              <BarChart3 className="w-16 h-16 text-slateqc-200 mb-4" />
              <p className="text-sm text-slateqc-500 mb-2">选择或运行一次回放在此查看对比结果</p>
              <p className="text-xs text-slateqc-400">沙盒规则 vs 正式规则，异常数量差异一目了然</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-base font-semibold text-slateqc-900">对比结果</h2>
                  <span className="text-xs text-slateqc-500">{currentPlayback.name}</span>
                </div>
                <button
                  onClick={handleExport}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  导出 CSV
                </button>
              </div>

              <div className="grid grid-cols-5 gap-3 mb-6">
                <div className="bg-white rounded-xl border border-slateqc-100 p-4">
                  <div className="text-xs text-slateqc-500 mb-1">正式规则异常</div>
                  <div className="text-2xl font-bold text-slateqc-900">{comparisonResult.summary.liveTotal}</div>
                </div>
                <div className="bg-white rounded-xl border border-slateqc-100 p-4">
                  <div className="text-xs text-slateqc-500 mb-1">沙盒规则异常</div>
                  <div className="text-2xl font-bold text-slateqc-900">{comparisonResult.summary.sandboxTotal}</div>
                </div>
                <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
                  <div className="text-xs text-emerald-600 mb-1">新增（沙盒特有）</div>
                  <div className="text-2xl font-bold text-emerald-700">+{comparisonResult.summary.newCount}</div>
                </div>
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <div className="text-xs text-amber-600 mb-1">消失（沙盒未检出）</div>
                  <div className="text-2xl font-bold text-amber-700">{comparisonResult.summary.missingCount}</div>
                </div>
                <div className={cn(
                  'rounded-xl border p-4',
                  comparisonResult.falsePositiveAnalysis?.sandboxRehitCount ?? 0 > 0
                    ? 'bg-rose-50 border-rose-200'
                    : 'bg-slate-50 border-slateqc-200',
                )}>
                  <div className={cn(
                    'text-xs mb-1',
                    comparisonResult.falsePositiveAnalysis?.sandboxRehitCount ?? 0 > 0
                      ? 'text-rose-600'
                      : 'text-slate-500',
                  )}>误报重新命中</div>
                  <div className={cn(
                    'text-2xl font-bold',
                    comparisonResult.falsePositiveAnalysis?.sandboxRehitCount ?? 0 > 0
                      ? 'text-rose-700'
                      : 'text-slate-900',
                  )}>
                    {comparisonResult.falsePositiveAnalysis?.sandboxRehitCount ?? 0}
                    {comparisonResult.falsePositiveAnalysis && (
                      <span className="text-xs font-normal ml-1 opacity-70">
                        /{comparisonResult.falsePositiveAnalysis.liveFalsePositiveCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3 border-b border-slateqc-100">
                {(['overview', 'anomalies', 'fp'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      activeTab === tab
                        ? 'border-accent-blue text-accent-blue'
                        : 'border-transparent text-slateqc-500 hover:text-slateqc-700',
                    )}
                  >
                    {tab === 'overview' ? '总览' : tab === 'anomalies' ? '异常明细' : '误报分析'}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-slateqc-100 p-4">
                    <h3 className="text-sm font-semibold text-slateqc-900 mb-3">按传感器对比</h3>
                    <div className="space-y-2">
                      {comparisonResult.bySensor.map((s) => (
                        <div key={s.sensorId} className="flex items-center gap-3 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="text-slateqc-700 text-xs truncate">{s.sensorName}</div>
                          </div>
                          <div className="text-xs text-slateqc-500 w-12 text-right">{s.liveCount}</div>
                          <div className="text-xs text-slateqc-400">→</div>
                          <div className="text-xs font-medium w-12 text-right">{s.sandboxCount}</div>
                          <div className={cn(
                            'text-xs font-medium w-16 text-right',
                            s.delta > 0 ? 'text-emerald-600' : s.delta < 0 ? 'text-amber-600' : 'text-slateqc-400',
                          )}>
                            {s.delta >= 0 ? '+' : ''}{s.delta}
                          </div>
                        </div>
                      ))}
                      {comparisonResult.bySensor.length === 0 && (
                        <p className="text-xs text-slateqc-400 text-center py-4">暂无数据</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slateqc-100 p-4">
                    <h3 className="text-sm font-semibold text-slateqc-900 mb-3">按异常类型对比</h3>
                    <div className="space-y-2">
                      {comparisonResult.byType.map((t) => (
                        <div key={t.type} className="flex items-center gap-3 text-sm">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: ANOMALY_TYPE_COLORS[t.type as keyof typeof ANOMALY_TYPE_COLORS] || '#94a3b8' }}
                          />
                          <div className="flex-1 text-xs text-slateqc-700">
                            {ANOMALY_TYPE_LABELS[t.type as keyof typeof ANOMALY_TYPE_LABELS] || t.type}
                          </div>
                          <div className="text-xs text-slateqc-500 w-10 text-right">{t.liveCount}</div>
                          <div className="text-xs text-slateqc-400">→</div>
                          <div className="text-xs font-medium w-10 text-right">{t.sandboxCount}</div>
                          <div className={cn(
                            'text-xs font-medium w-12 text-right',
                            t.delta > 0 ? 'text-emerald-600' : t.delta < 0 ? 'text-amber-600' : 'text-slateqc-400',
                          )}>
                            {t.delta >= 0 ? '+' : ''}{t.delta}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'anomalies' && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    {(['all', 'new', 'missing'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setAnomalyFilter(f)}
                        className={cn(
                          'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                          anomalyFilter === f
                            ? 'bg-accent-blue text-white'
                            : 'bg-slateqc-50 text-slateqc-600 hover:bg-slateqc-100',
                        )}
                      >
                        {f === 'all' ? '全部' : f === 'new' ? '新增异常' : '消失异常'}
                      </button>
                    ))}
                    <span className="text-xs text-slateqc-400 ml-2">共 {filteredAnomalies.length} 条</span>
                  </div>
                  <div className="bg-white rounded-xl border border-slateqc-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slateqc-50 text-xs text-slateqc-500">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium">类型</th>
                          <th className="px-4 py-2.5 text-left font-medium">传感器</th>
                          <th className="px-4 py-2.5 text-left font-medium">描述</th>
                          <th className="px-4 py-2.5 text-left font-medium">读数时间</th>
                          <th className="px-4 py-2.5 text-left font-medium">温度</th>
                          <th className="px-4 py-2.5 text-left font-medium">湿度</th>
                          <th className="px-4 py-2.5 text-left font-medium">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slateqc-50">
                        {filteredAnomalies.slice(0, 100).map((a) => (
                          <tr key={a.id} className="hover:bg-slateqc-50/50">
                            <td className="px-4 py-3">
                              <span
                                className="inline-block px-2 py-0.5 text-[10px] rounded font-medium text-white"
                                style={{ backgroundColor: ANOMALY_TYPE_COLORS[a.type as keyof typeof ANOMALY_TYPE_COLORS] || '#94a3b8' }}
                              >
                                {ANOMALY_TYPE_LABELS[a.type as keyof typeof ANOMALY_TYPE_LABELS] || a.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slateqc-700">{a.sensorId}</td>
                            <td className="px-4 py-3 text-xs text-slateqc-600 max-w-xs truncate">{a.description}</td>
                            <td className="px-4 py-3 text-xs text-slateqc-500 font-mono">
                              {new Date(a.readingTimestamp).toLocaleString('zh-CN')}
                            </td>
                            <td className="px-4 py-3 text-xs text-slateqc-700">{a.temperature?.toFixed(2)}℃</td>
                            <td className="px-4 py-3 text-xs text-slateqc-700">{a.humidity?.toFixed(2)}%</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'text-[10px] font-medium px-2 py-0.5 rounded',
                                a.isNewComparedToLive ? 'bg-emerald-100 text-emerald-700' :
                                a.isMissingComparedToLive ? 'bg-amber-100 text-amber-700' :
                                'bg-slateqc-100 text-slateqc-600',
                              )}>
                                {a.isNewComparedToLive ? '沙盒新增' : a.isMissingComparedToLive ? '沙盒未检出' : '两者都有'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {filteredAnomalies.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slateqc-400 text-sm">
                              暂无匹配的异常记录
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {filteredAnomalies.length > 100 && (
                      <div className="px-4 py-2 text-center text-xs text-slateqc-400 bg-slateqc-50">
                        仅展示前 100 条，完整数据请导出 CSV 查看
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'fp' && (
                <div>
                  {!comparisonResult.falsePositiveAnalysis ? (
                    <div className="bg-white rounded-xl border border-slateqc-100 p-8 text-center">
                      <ShieldAlert className="w-10 h-10 text-slateqc-300 mx-auto mb-3" />
                      <p className="text-sm text-slateqc-500">本次回放暂无误报对比分析</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="bg-white rounded-xl border border-slateqc-100 p-5">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                            <span className="text-xs text-slateqc-500">正式规则误报标记数</span>
                          </div>
                          <div className="text-3xl font-bold text-slateqc-900">
                            {comparisonResult.falsePositiveAnalysis.liveFalsePositiveCount}
                          </div>
                        </div>
                        <div className={cn(
                          'rounded-xl border p-5',
                          comparisonResult.falsePositiveAnalysis.sandboxRehitCount > 0
                            ? 'bg-rose-50 border-rose-200'
                            : 'bg-emerald-50 border-emerald-200',
                        )}>
                          <div className="flex items-center gap-2 mb-2">
                            <XCircle className={cn(
                              'w-4 h-4',
                              comparisonResult.falsePositiveAnalysis.sandboxRehitCount > 0
                                ? 'text-rose-500'
                                : 'text-emerald-500',
                            )} />
                            <span className={cn(
                              'text-xs',
                              comparisonResult.falsePositiveAnalysis.sandboxRehitCount > 0
                                ? 'text-rose-500'
                                : 'text-emerald-600',
                            )}>沙盒重新命中数</span>
                          </div>
                          <div className={cn(
                            'text-3xl font-bold',
                            comparisonResult.falsePositiveAnalysis.sandboxRehitCount > 0
                              ? 'text-rose-700'
                              : 'text-emerald-700',
                          )}>
                            {comparisonResult.falsePositiveAnalysis.sandboxRehitCount}
                          </div>
                        </div>
                        <div className={cn(
                          'rounded-xl border p-5',
                          comparisonResult.falsePositiveAnalysis.sandboxRehitRate > 0.05
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-white border-slateqc-100',
                        )}>
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className={cn(
                              'w-4 h-4',
                              comparisonResult.falsePositiveAnalysis.sandboxRehitRate > 0.05
                                ? 'text-amber-500'
                                : 'text-slateqc-400',
                            )} />
                            <span className="text-xs text-slateqc-500">误报重命中率</span>
                          </div>
                          <div className={cn(
                            'text-3xl font-bold',
                            comparisonResult.falsePositiveAnalysis.sandboxRehitRate > 0.05
                              ? 'text-amber-700'
                              : 'text-slateqc-900',
                          )}>
                            {(comparisonResult.falsePositiveAnalysis.sandboxRehitRate * 100).toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl border border-slateqc-100 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slateqc-100 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-slateqc-900">误报详情</h3>
                          <span className="text-xs text-slateqc-400">
                            共 {comparisonResult.falsePositiveAnalysis.details.length} 条记录
                          </span>
                        </div>
                        {comparisonResult.falsePositiveAnalysis.details.length === 0 ? (
                          <div className="p-8 text-center">
                            <CheckCircle className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
                            <p className="text-sm text-slateqc-500">所有历史误报在沙盒规则下均未重新命中，阈值调整有效！</p>
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-slateqc-50 text-xs text-slateqc-500">
                              <tr>
                                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                                <th className="px-4 py-2.5 text-left font-medium">传感器</th>
                                <th className="px-4 py-2.5 text-left font-medium">异常类型</th>
                                <th className="px-4 py-2.5 text-left font-medium">原异常描述</th>
                                <th className="px-4 py-2.5 text-left font-medium">读数时间</th>
                                <th className="px-4 py-2.5 text-left font-medium">标注原因</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slateqc-50">
                              {comparisonResult.falsePositiveAnalysis.details.slice(0, 100).map((d) => (
                                <tr key={d.anomalyId} className={cn(
                                  d.sandboxRehit ? 'bg-rose-50/50 hover:bg-rose-50' : 'hover:bg-slateqc-50/50',
                                )}>
                                  <td className="px-4 py-3">
                                    <span className={cn(
                                      'text-[10px] font-medium px-2 py-0.5 rounded',
                                      d.sandboxRehit
                                        ? 'bg-rose-100 text-rose-700'
                                        : 'bg-emerald-100 text-emerald-700',
                                    )}>
                                      {d.sandboxRehit ? '重新命中' : '未重命中'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slateqc-700">{d.sensorId}</td>
                                  <td className="px-4 py-3 text-xs text-slateqc-700">
                                    {ANOMALY_TYPE_LABELS[d.type as keyof typeof ANOMALY_TYPE_LABELS] || d.type}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slateqc-600 max-w-xs truncate">{d.description}</td>
                                  <td className="px-4 py-3 text-xs text-slateqc-500 font-mono">
                                    {new Date(d.readingTimestamp).toLocaleString('zh-CN')}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slateqc-600 max-w-xs truncate">{d.annotationReason || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {showPublishDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-slateqc-900 mb-4">发布为正式规则</h2>

            {publishConflict?.hasConflict ? (
              <div className="mb-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">检测到发布冲突</p>
                    <p className="text-xs text-amber-600 mt-0.5">正式规则在你创建沙盒后已被修改，请确认差异后再发布</p>
                  </div>
                </div>

                <div className="bg-slateqc-50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-slateqc-700 mb-2">差异字段：</p>
                  {publishConflict.differences.map((diff) => (
                    <div key={diff.field} className="flex items-center justify-between text-xs">
                      <span className="text-slateqc-600">{diff.field}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slateqc-500">正式: <span className="font-mono font-medium text-slateqc-700">{diff.liveValue}</span></span>
                        <span className="text-slateqc-400">→</span>
                        <span className="text-accent-blue">沙盒: <span className="font-mono font-medium">{diff.sandboxValue}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-800">无冲突，可以安全发布</p>
                  <p className="text-xs text-emerald-600 mt-0.5">正式规则与沙盒基准版本一致</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPublishDialog(false)}
                className="btn-secondary text-xs"
              >
                取消
              </button>
              {publishConflict?.hasConflict ? (
                <button
                  onClick={() => void handlePublish(true)}
                  className="btn-primary text-xs bg-amber-500 hover:bg-amber-600"
                >
                  强制发布
                </button>
              ) : (
                <button
                  onClick={() => void handlePublish(false)}
                  className="btn-primary text-xs"
                >
                  确认发布
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

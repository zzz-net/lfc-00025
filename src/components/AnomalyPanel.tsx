import { useState, useMemo } from 'react';
import useQCStore from '@/store';
import type { Anomaly, Annotation, AnnotationStatus } from '../../shared/types.js';
import { ANOMALY_TYPE_LABELS, ANOMALY_TYPE_COLORS, STATUS_LABELS, STATUS_COLORS } from '../../shared/types.js';
import { AlertTriangle, Filter, Undo2, Tag, User, MessageSquare, Clock, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AnomalyPanel({ onAnnotate }: { onAnnotate: (a: Anomaly) => void }) {
  const anomalies = useQCStore((s) => s.anomalies);
  const statusFilter = useQCStore((s) => s.statusFilter);
  const setStatusFilter = useQCStore((s) => s.setStatusFilter);
  const loading = useQCStore((s) => s.loading.anomalies);
  const history = useQCStore((s) => s.annotationsHistory);
  const rollback = useQCStore((s) => s.rollbackLast);
  const selectedId = useQCStore((s) => s.selectedSensorId);

  const [tab, setTab] = useState<'anomalies' | 'history'>('anomalies');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');

  const latest = history.find((h) => !h.rolledBackAt);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = anomalies;
    if (selectedId) arr = arr.filter((a) => a.sensorId === selectedId);
    if (statusFilter && statusFilter !== 'ALL') {
      arr = arr.filter((a) => {
        const s = a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED');
        return s === statusFilter;
      });
    }
    if (q) {
      arr = arr.filter((a) =>
        a.description.toLowerCase().includes(q) ||
        (a.sensorName || '').toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [anomalies, query, statusFilter, selectedId]);

  const stats = useMemo(() => {
    const s: Record<string, number> = { ALL: anomalies.length };
    for (const a of anomalies) {
      const st = a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED');
      s[st] = (s[st] || 0) + 1;
    }
    return s;
  }, [anomalies]);

  const options: { key: 'ALL' | AnnotationStatus; label: string }[] = [
    { key: 'ALL', label: '全部' },
    { key: 'DETECTED', label: '待处理' },
    { key: 'PENDING', label: '待确认' },
    { key: 'ACCEPTED', label: '已接受' },
    { key: 'FALSE_POSITIVE', label: '误报' },
    { key: 'RETEST', label: '需复测' },
  ];

  return (
    <div className="card flex flex-col h-full min-h-0 animate-fade-in">
      <div className="p-4 border-b border-slateqc-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5 text-accent-red" />
            </div>
            <div>
              <h2 className="font-bold text-slateqc-900">异常管理</h2>
              <p className="text-[11px] text-slateqc-400 font-mono">共 {anomalies.length} 条 · 筛选 {filtered.length} 条</p>
            </div>
          </div>
          {latest && (
            <button
              onClick={() => setRollbackOpen(true)}
              className="btn-ghost !p-2 text-slateqc-500 hover:text-accent-violet group"
              title="回滚最近一次标注"
            >
              <Undo2 className="w-4 h-4 group-hover:rotate-[-20deg] transition-transform" />
            </button>
          )}
        </div>

        <div className="flex gap-1 border-b border-slateqc-100 mb-3">
          {[
            { k: 'anomalies', label: '异常列表', count: filtered.length },
            { k: 'history', label: '操作历史', count: history.length },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as any)}
              className={cn(
                'flex-1 pb-2.5 text-xs font-semibold transition-all relative',
                tab === t.k ? 'text-accent-blue' : 'text-slateqc-400 hover:text-slateqc-600',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'ml-1.5 px-1.5 py-0.5 rounded text-[10px]',
                  tab === t.k ? 'bg-accent-blue/10 text-accent-blue' : 'bg-slateqc-100 text-slateqc-500',
                )}
              >
                {t.count}
              </span>
              {tab === t.k && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-blue rounded-t" />
              )}
            </button>
          ))}
        </div>

        {tab === 'anomalies' && (
          <>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slateqc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input-field !pl-9"
                placeholder="搜索异常描述、传感器..."
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {options.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setStatusFilter(o.key)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all',
                    statusFilter === o.key
                      ? o.key === 'ALL'
                        ? 'bg-slateqc-900 text-white'
                        : 'text-white shadow-soft'
                      : 'bg-slateqc-50 text-slateqc-500 hover:bg-slateqc-100',
                  )}
                  style={statusFilter === o.key && o.key !== 'ALL'
                    ? { background: STATUS_COLORS[o.key as AnnotationStatus] }
                    : undefined}
                >
                  <Filter className="w-3 h-3 inline mr-1 -mt-0.5" />
                  {o.label}
                  <span className="ml-1 opacity-80 font-mono text-[10px]">
                    {stats[o.key] || 0}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slateqc-100 animate-pulse" />
            ))}
          </div>
        ) : tab === 'anomalies' ? (
          filtered.length === 0 ? (
            <div className="text-center p-10">
              <Tag className="w-10 h-10 mx-auto text-slateqc-200 mb-3" />
              <p className="text-slateqc-400 text-sm">
                {query || statusFilter !== 'ALL' ? '没有匹配的异常' : '一切正常，暂无异常'}
              </p>
            </div>
          ) : (
            filtered.map((a, idx) => (
              <AnomalyCard
                key={a.id}
                anomaly={a}
                index={idx}
                expanded={expanded === a.id}
                onToggle={() => setExpanded(expanded === a.id ? null : a.id)}
                onAnnotate={() => onAnnotate(a)}
              />
            ))
          )
        ) : (
          history.length === 0 ? (
            <div className="text-center p-10">
              <Clock className="w-10 h-10 mx-auto text-slateqc-200 mb-3" />
              <p className="text-slateqc-400 text-sm">暂无标注记录</p>
            </div>
          ) : (
            history.map((h, idx) => (
              <HistoryRow key={h.id} h={h} idx={idx} />
            ))
          )
        )}
      </div>

      {rollbackOpen && (
        <RollbackDialog
          latest={latest!}
          reason={rollbackReason}
          setReason={setRollbackReason}
          onClose={() => {
            setRollbackOpen(false);
            setRollbackReason('');
          }}
          onConfirm={() => {
            void rollback(rollbackReason || undefined);
            setRollbackOpen(false);
            setRollbackReason('');
          }}
        />
      )}
    </div>
  );
}

function AnomalyCard({
  anomaly, index, expanded, onToggle, onAnnotate,
}: {
  anomaly: Anomaly;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onAnnotate: () => void;
}) {
  const status = anomaly.latestAnnotation?.rolledBackAt
    ? 'DETECTED'
    : (anomaly.latestAnnotation?.status || 'DETECTED');
  const typeColor = ANOMALY_TYPE_COLORS[anomaly.type];
  const statusColor = STATUS_COLORS[status as AnnotationStatus];

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 20) * 25}ms` }}
      className={cn(
        'rounded-xl border transition-all animate-fade-in overflow-hidden',
        status === 'FALSE_POSITIVE'
          ? 'bg-slateqc-50/50 border-slateqc-100'
          : 'bg-white hover:shadow-soft border-slateqc-100',
      )}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-3"
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              'w-8 h-8 rounded-lg shrink-0 mt-0.5 flex items-center justify-center',
            )}
            style={{ background: typeColor + '18' }}
          >
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                status === 'DETECTED' && 'animate-pulse-ring',
              )}
              style={{ background: typeColor }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                style={{ background: typeColor + '18', color: typeColor }}
              >
                {ANOMALY_TYPE_LABELS[anomaly.type]}
              </span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: statusColor + '18', color: statusColor }}
              >
                {STATUS_LABELS[status as AnnotationStatus]}
              </span>
              <span className="text-[11px] text-slateqc-400 font-mono ml-auto">
                {anomaly.reading?.timestamp.replace('T', ' ').substring(5, 16)}
              </span>
            </div>
            <p className="text-xs font-medium text-slateqc-800 mb-1 leading-snug">
              {anomaly.description}
            </p>
            <div className="flex items-center gap-3 text-[11px] text-slateqc-400">
              <span>{anomaly.sensorName}</span>
              <span className="font-mono">
                {anomaly.reading?.temperature.toFixed(1)}℃ / {anomaly.reading?.humidity.toFixed(0)}%
              </span>
            </div>

            {anomaly.latestAnnotation && !anomaly.latestAnnotation.rolledBackAt && (
              <div className="mt-2 p-2 rounded-lg bg-slateqc-50 border border-slateqc-100 space-y-0.5">
                <div className="flex items-center gap-2 text-[11px] text-slateqc-500">
                  <User className="w-3 h-3" />
                  <span className="font-semibold text-slateqc-700">{anomaly.latestAnnotation.handler}</span>
                  <span className="text-slateqc-300">·</span>
                  <Clock className="w-3 h-3" />
                  <span className="font-mono">
                    {anomaly.latestAnnotation.createdAt.replace('T', ' ').substring(5, 16)}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-slateqc-600">
                  <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="line-clamp-2">{anomaly.latestAnnotation.reason}</span>
                </div>
              </div>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slateqc-400 shrink-0 mt-2" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slateqc-400 shrink-0 mt-2" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-slateqc-50 bg-slateqc-50/40">
          <div className="pt-3 grid grid-cols-2 gap-2 text-[11px] mb-3 font-mono">
            <div className="p-2 rounded-md bg-white border border-slateqc-100">
              <span className="text-slateqc-400 block mb-0.5">温度</span>
              <span className="text-accent-orange font-bold text-sm">{anomaly.reading?.temperature.toFixed(2)}℃</span>
            </div>
            <div className="p-2 rounded-md bg-white border border-slateqc-100">
              <span className="text-slateqc-400 block mb-0.5">湿度</span>
              <span className="text-accent-cyan font-bold text-sm">{anomaly.reading?.humidity.toFixed(1)}%</span>
            </div>
          </div>
          <button
            onClick={onAnnotate}
            className="w-full btn-primary !py-2 justify-center text-sm"
          >
            <Tag className="w-4 h-4" />
            {anomaly.latestAnnotation && !anomaly.latestAnnotation.rolledBackAt
              ? '修改标注'
              : '人工标注'}
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ h, idx }: { h: Annotation; idx: number }) {
  const statusColor = STATUS_COLORS[h.status];
  const rolled = !!h.rolledBackAt;
  return (
    <div
      style={{ animationDelay: `${Math.min(idx, 20) * 25}ms` }}
      className={cn(
        'rounded-xl border p-3 animate-fade-in',
        rolled ? 'bg-slateqc-50/70 border-slateqc-100 opacity-60' : 'bg-white border-slateqc-100',
      )}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-md"
          style={{ background: (ANOMALY_TYPE_COLORS as any)[h.anomalyType] + '18', color: (ANOMALY_TYPE_COLORS as any)[h.anomalyType] }}
        >
          {(ANOMALY_TYPE_LABELS as any)[h.anomalyType]}
        </span>
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
          style={{ background: statusColor + '18', color: statusColor }}
        >
          {STATUS_LABELS[h.status]}
        </span>
        {rolled && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slateqc-200 text-slateqc-600 line-through">
            已回滚
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-slateqc-700 mb-1">{h.sensorName}</p>
      <p className="text-[11px] text-slateqc-500 mb-2 flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        <span className="font-mono">{h.timestamp?.replace('T', ' ').substring(0, 16)}</span>
        <span className="mx-1 text-slateqc-300">→</span>
        <span className="font-mono">{h.createdAt.replace('T', ' ').substring(0, 16)}</span>
      </p>
      <div className="flex items-start gap-2 text-[11px]">
        <User className="w-3 h-3 text-slateqc-400 mt-0.5 shrink-0" />
        <span className="font-semibold text-slateqc-700 shrink-0">{h.handler}：</span>
        <MessageSquare className="w-3 h-3 text-slateqc-400 mt-0.5 shrink-0" />
        <span className="text-slateqc-600 line-clamp-2">{h.reason}</span>
      </div>
      {rolled && (
        <div className="mt-2 p-2 rounded-lg bg-slateqc-100/60 text-[11px] text-slateqc-500 flex items-start gap-2">
          <Undo2 className="w-3 h-3 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">已回滚：</span>
            {h.rollbackReason || '撤销标注'}
          </div>
        </div>
      )}
    </div>
  );
}

function RollbackDialog({
  latest, reason, setReason, onClose, onConfirm,
}: {
  latest: Annotation;
  reason: string;
  setReason: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-slateqc-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-6 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-violet-100 text-accent-violet flex items-center justify-center shrink-0">
            <Undo2 className="w-5.5 h-5.5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slateqc-900 text-lg mb-1">回滚最近一次标注</h3>
            <p className="text-sm text-slateqc-500">将恢复异常为"待处理"状态，可重新标注</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slateqc-50 border border-slateqc-100 mb-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slateqc-500">传感器</span>
            <span className="font-medium">{latest.sensorName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slateqc-500">异常类型</span>
            <span className="font-medium">{(ANOMALY_TYPE_LABELS as any)[latest.anomalyType]}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slateqc-500">原状态</span>
            <span
              className="font-semibold px-2 py-0.5 rounded-md"
              style={{
                background: STATUS_COLORS[latest.status] + '22',
                color: STATUS_COLORS[latest.status],
              }}
            >
              {STATUS_LABELS[latest.status]}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slateqc-500">处理人</span>
            <span className="font-medium">{latest.handler}</span>
          </div>
        </div>

        <label className="label-text">回滚原因（可选）</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="input-field resize-none mb-5"
          placeholder="如：标注错误、误操作、重新评估等"
        />

        <div className="flex gap-2">
          <button className="btn-secondary flex-1 justify-center" onClick={onClose}>取消</button>
          <button className="btn-danger flex-1 justify-center" onClick={onConfirm}>
            <Undo2 className="w-4 h-4" />
            确认回滚
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import useQCStore from '@/store';
import type { Anomaly, AnnotationStatus } from '../../shared/types.js';
import { ANOMALY_TYPE_LABELS, STATUS_LABELS, STATUS_COLORS } from '../../shared/types.js';
import { X, Tag, CheckCircle2, AlertOctagon, Ban, RefreshCw, AlertCircle, User, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPTIONS: { key: AnnotationStatus; label: string; icon: any; desc: string }[] = [
  { key: 'PENDING', label: '待确认', icon: AlertCircle, desc: '需进一步核实' },
  { key: 'ACCEPTED', label: '已接受', icon: CheckCircle2, desc: '确认为真实异常' },
  { key: 'FALSE_POSITIVE', label: '误报', icon: Ban, desc: '系统误判，数据正常' },
  { key: 'RETEST', label: '需复测', icon: RefreshCw, desc: '安排重新测量' },
];

export default function AnnotationDialog({
  anomaly, onClose,
}: {
  anomaly: Anomaly | null;
  onClose: () => void;
}) {
  const annotate = useQCStore((s) => s.annotate);
  const [status, setStatus] = useState<AnnotationStatus>('PENDING');
  const [handler, setHandler] = useState(
    () => localStorage.getItem('qc_last_handler') || '',
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (anomaly) {
      if (anomaly.latestAnnotation && !anomaly.latestAnnotation.rolledBackAt) {
        setStatus(anomaly.latestAnnotation.status);
        setHandler(anomaly.latestAnnotation.handler);
        setReason(anomaly.latestAnnotation.reason);
      } else {
        setStatus('PENDING');
        setReason('');
      }
    }
  }, [anomaly]);

  if (!anomaly) return null;

  const doSubmit = async () => {
    if (!handler.trim() || !reason.trim()) return;
    setSubmitting(true);
    try {
      localStorage.setItem('qc_last_handler', handler.trim());
      await annotate(anomaly.id, {
        status,
        handler: handler.trim(),
        reason: reason.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-slateqc-900/50 backdrop-blur-sm flex items-stretch justify-end animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto scrollbar-thin animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-4 bg-white/90 backdrop-blur border-b border-slateqc-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slateqc-900 text-lg flex items-center gap-2">
              <Tag className="w-5 h-5 text-accent-blue" />
              异常标注
            </h2>
            <p className="text-[11px] text-slateqc-400 font-mono mt-0.5">
              #{anomaly.id.substring(0, 12)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !p-2 rounded-full hover:bg-slateqc-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slateqc-50 to-white border border-slateqc-100">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-red-100 text-accent-red">
                {ANOMALY_TYPE_LABELS[anomaly.type]}
              </span>
              <span className="text-[11px] text-slateqc-500 font-mono">
                {anomaly.reading?.timestamp.replace('T', ' ')}
              </span>
            </div>
            <h3 className="font-semibold text-slateqc-900 mb-2 leading-snug">
              {anomaly.description}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-slateqc-100">
                <div className="text-slateqc-400 mb-1">传感器</div>
                <div className="font-semibold text-slateqc-800">{anomaly.sensorName}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slateqc-100">
                <div className="text-slateqc-400 mb-1">温度 / 湿度</div>
                <div className="font-semibold font-mono text-slateqc-800">
                  {anomaly.reading?.temperature.toFixed(1)}℃ · {anomaly.reading?.humidity.toFixed(0)}%
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="label-text flex items-center gap-1.5">
              <AlertOctagon className="w-3.5 h-3.5" />
              选择复核结论
            </label>
            <div className="grid grid-cols-2 gap-2">
              {OPTIONS.map((o) => {
                const Icon = o.icon;
                const active = status === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setStatus(o.key)}
                    className={cn(
                      'p-3.5 rounded-xl border-2 text-left transition-all',
                      active
                        ? 'shadow-soft'
                        : 'border-slateqc-100 hover:border-slateqc-200 bg-white',
                    )}
                    style={active ? {
                      borderColor: STATUS_COLORS[o.key],
                      background: STATUS_COLORS[o.key] + '0D',
                    } : undefined}
                  >
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg mb-2 flex items-center justify-center',
                      )}
                      style={{ background: STATUS_COLORS[o.key] + (active ? '18' : '10') }}
                    >
                      <Icon className="w-4.5 h-4.5" style={{ color: STATUS_COLORS[o.key] }} />
                    </div>
                    <div
                      className="font-bold text-sm mb-0.5"
                      style={{ color: active ? STATUS_COLORS[o.key] : '#1E293B' }}
                    >
                      {o.label}
                    </div>
                    <div className="text-[11px] text-slateqc-400 leading-snug">{o.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label-text flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              处理人
            </label>
            <input
              value={handler}
              onChange={(e) => setHandler(e.target.value)}
              className="input-field"
              placeholder="您的姓名或工号，如：张三 / QC-001"
            />
          </div>

          <div>
            <label className="label-text flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                处理原因 / 备注
              </span>
              <span className={cn(
                'text-[10px] font-mono',
                reason.length > 450 ? 'text-accent-red' : 'text-slateqc-400',
              )}>
                {reason.length}/500
              </span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={5}
              className="input-field resize-none"
              placeholder="说明您判断的依据、现场情况、后续措施等详细信息..."
            />
          </div>

          <div className="sticky bottom-0 bg-white pt-3 pb-1 border-t border-slateqc-50 -mx-5 px-5">
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="btn-secondary flex-1 justify-center"
              >
                取消
              </button>
              <button
                onClick={() => void doSubmit()}
                disabled={submitting || !handler.trim() || !reason.trim()}
                className="btn-primary flex-1 justify-center"
                style={{ background: STATUS_COLORS[status] }}
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    确认为「{STATUS_LABELS[status]}」
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

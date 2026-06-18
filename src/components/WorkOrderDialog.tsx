import { useState, useEffect } from 'react';
import useQCStore from '@/store';
import type { Anomaly, WorkOrderPriority } from '../../shared/types.js';
import { ANOMALY_TYPE_LABELS, WORK_ORDER_PRIORITY_LABELS, WORK_ORDER_PRIORITY_COLORS } from '../../shared/types.js';
import { X, ClipboardList, AlertTriangle, User, Calendar, MessageSquare, Flag, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIORITY_OPTIONS: { key: WorkOrderPriority; label: string; desc: string }[] = [
  { key: 'URGENT', label: '紧急', desc: '立即处理，最高优先级' },
  { key: 'HIGH', label: '高', desc: '尽快处理，今日内完成' },
  { key: 'NORMAL', label: '普通', desc: '正常流程，3 个工作日内' },
  { key: 'LOW', label: '低', desc: '有空再处理，非紧急' },
];

export default function WorkOrderDialog({
  anomaly, onClose,
}: {
  anomaly: Anomaly | null;
  onClose: () => void;
}) {
  const createWorkOrder = useQCStore((s) => s.createWorkOrder);
  const [priority, setPriority] = useState<WorkOrderPriority>('NORMAL');
  const [assignee, setAssignee] = useState(
    () => localStorage.getItem('qc_last_handler') || '',
  );
  const [creator, setCreator] = useState(
    () => localStorage.getItem('qc_last_handler') || '',
  );
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (anomaly) {
      setTitle(`复测：${ANOMALY_TYPE_LABELS[anomaly.type]} - ${anomaly.sensorName || anomaly.sensorId}`);
    }
  }, [anomaly]);

  if (!anomaly) return null;

  const doSubmit = async () => {
    if (!assignee.trim() || !creator.trim() || !title.trim()) return;
    setSubmitting(true);
    try {
      localStorage.setItem('qc_last_handler', creator.trim());
      const result = await createWorkOrder({
        anomalyId: anomaly.id,
        title: title.trim(),
        priority,
        assignee: assignee.trim(),
        creator: creator.trim(),
        deadline: deadline || undefined,
        remark: remark || undefined,
      });
      if (result) onClose();
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
              <ClipboardList className="w-5 h-5 text-accent-violet" />
              创建复测工单
            </h2>
            <p className="text-[11px] text-slateqc-400 font-mono mt-0.5">
              关联异常 #{anomaly.id.substring(0, 12)}
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
          <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-50 to-white border border-violet-100">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-accent-red" />
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-red-100 text-accent-red">
                {ANOMALY_TYPE_LABELS[anomaly.type]}
              </span>
              <span className="text-[11px] text-slateqc-500 font-mono">
                {anomaly.reading?.timestamp.replace('T', ' ')}
              </span>
            </div>
            <h3 className="font-semibold text-slateqc-900 mb-2 leading-snug text-sm">
              {anomaly.description}
            </h3>
            <div className="flex items-center gap-3 text-[11px] text-slateqc-500">
              <span>{anomaly.sensorName}</span>
              <span className="font-mono">
                {anomaly.reading?.temperature.toFixed(1)}℃ / {anomaly.reading?.humidity.toFixed(0)}%
              </span>
            </div>
          </div>

          <div>
            <label className="label-text flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              工单标题
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 100))}
              className="input-field"
              placeholder="简要描述工单目标"
            />
          </div>

          <div>
            <label className="label-text flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5" />
              优先级
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRIORITY_OPTIONS.map((o) => {
                const active = priority === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setPriority(o.key)}
                    className={cn(
                      'p-3 rounded-xl border-2 text-left transition-all',
                      active ? 'shadow-soft' : 'border-slateqc-100 hover:border-slateqc-200 bg-white',
                    )}
                    style={active ? {
                      borderColor: WORK_ORDER_PRIORITY_COLORS[o.key],
                      background: WORK_ORDER_PRIORITY_COLORS[o.key] + '0D',
                    } : undefined}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <ChevronRight className="w-3.5 h-3.5" style={{ color: WORK_ORDER_PRIORITY_COLORS[o.key] }} />
                      <span
                        className="font-bold text-sm"
                        style={{ color: active ? WORK_ORDER_PRIORITY_COLORS[o.key] : '#1E293B' }}
                      >
                        {WORK_ORDER_PRIORITY_LABELS[o.key]}
                      </span>
                    </div>
                    <div className="text-[11px] text-slateqc-400 leading-snug pl-5">{o.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-text flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                创建人
              </label>
              <input
                value={creator}
                onChange={(e) => setCreator(e.target.value)}
                className="input-field"
                placeholder="您的姓名"
              />
            </div>
            <div>
              <label className="label-text flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                处理人
              </label>
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="input-field"
                placeholder="指派给谁处理"
              />
            </div>
          </div>

          <div>
            <label className="label-text flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              截止时间（可选）
            </label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label className="label-text flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                备注（可选）
              </span>
              <span className={cn(
                'text-[10px] font-mono',
                remark.length > 450 ? 'text-accent-red' : 'text-slateqc-400',
              )}>
                {remark.length}/500
              </span>
            </label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value.slice(0, 500))}
              rows={4}
              className="input-field resize-none"
              placeholder="补充说明、处理要求、注意事项等"
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
                disabled={submitting || !assignee.trim() || !creator.trim() || !title.trim()}
                className="btn-primary flex-1 justify-center"
                style={{ background: WORK_ORDER_PRIORITY_COLORS[priority] }}
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    创建中...
                  </>
                ) : (
                  <>
                    <ClipboardList className="w-4 h-4" />
                    创建工单
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

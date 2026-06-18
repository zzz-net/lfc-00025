import { useState, useMemo } from 'react';
import useQCStore from '@/store';
import type {
  WorkOrder, WorkOrderPriority, WorkOrderStatus, WorkOrderHistory,
} from '../../shared/types.js';
import {
  WORK_ORDER_PRIORITY_LABELS, WORK_ORDER_PRIORITY_COLORS,
  WORK_ORDER_STATUS_LABELS, WORK_ORDER_STATUS_COLORS,
  WORK_ORDER_ACTION_LABELS, ANOMALY_TYPE_LABELS, ANOMALY_TYPE_COLORS,
} from '../../shared/types.js';
import {
  ClipboardList, Filter, User, Clock, Calendar, MessageSquare, Flag,
  ChevronDown, ChevronUp, FileSpreadsheet, X, AlertTriangle,
  UserPlus, XCircle, Undo2, Play, Pause, Search, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

export default function WorkOrderPanel() {
  const workOrders = useQCStore((s) => s.workOrders);
  const workOrderFilter = useQCStore((s) => s.workOrderFilter);
  const setWorkOrderFilter = useQCStore((s) => s.setWorkOrderFilter);
  const sensors = useQCStore((s) => s.sensors);
  const workOrderAssignees = useQCStore((s) => s.workOrderAssignees);
  const loading = useQCStore((s) => s.loading.workOrders);
  const exportWorkOrdersCsv = useQCStore((s) => s.exportWorkOrdersCsv);

  const [tab, setTab] = useState<'list' | 'history'>('list');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reassignOpen, setReassignOpen] = useState<WorkOrder | null>(null);
  const [closeOpen, setCloseOpen] = useState<WorkOrder | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ wo: WorkOrder; history: WorkOrderHistory[] } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = workOrders;
    if (q) {
      arr = arr.filter((wo) =>
        wo.title.toLowerCase().includes(q) ||
        wo.assignee.toLowerCase().includes(q) ||
        wo.creator.toLowerCase().includes(q) ||
        (wo.anomaly?.sensorName || '').toLowerCase().includes(q) ||
        wo.remark?.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [workOrders, query]);

  const stats = useMemo(() => {
    const s: Record<string, number> = { ALL: workOrders.length };
    for (const wo of workOrders) {
      s[wo.status] = (s[wo.status] || 0) + 1;
    }
    return s;
  }, [workOrders]);

  const statusOptions: { key: WorkOrderStatus | 'ALL'; label: string }[] = [
    { key: 'ALL', label: '全部' },
    { key: 'PENDING', label: '待处理' },
    { key: 'IN_PROGRESS', label: '处理中' },
    { key: 'CLOSED', label: '已关闭' },
  ];

  const priorityOptions: { key: WorkOrderPriority | 'ALL'; label: string }[] = [
    { key: 'ALL', label: '全部优先级' },
    { key: 'URGENT', label: '紧急' },
    { key: 'HIGH', label: '高' },
    { key: 'NORMAL', label: '普通' },
    { key: 'LOW', label: '低' },
  ];

  return (
    <div className="card flex flex-col h-full min-h-0 animate-fade-in">
      <div className="p-4 border-b border-slateqc-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
              <ClipboardList className="w-4.5 h-4.5 text-accent-violet" />
            </div>
            <div>
              <h2 className="font-bold text-slateqc-900">复测工单</h2>
              <p className="text-[11px] text-slateqc-400 font-mono">
                共 {workOrders.length} 条 · 筛选 {filtered.length} 条
              </p>
            </div>
          </div>
          <button
            onClick={() => void exportWorkOrdersCsv()}
            className="btn-ghost !p-2 text-slateqc-500 hover:text-accent-blue group"
            title="导出 CSV"
          >
            <FileSpreadsheet className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slateqc-100 mb-3">
          {[
            { k: 'list', label: '工单列表', count: filtered.length },
            { k: 'history', label: '操作说明', count: 0 },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as any)}
              className={cn(
                'flex-1 pb-2.5 text-xs font-semibold transition-all relative',
                tab === t.k ? 'text-accent-violet' : 'text-slateqc-400 hover:text-slateqc-600',
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={cn(
                    'ml-1.5 px-1.5 py-0.5 rounded text-[10px]',
                    tab === t.k ? 'bg-accent-violet/10 text-accent-violet' : 'bg-slateqc-100 text-slateqc-500',
                  )}
                >
                  {t.count}
                </span>
              )}
              {tab === t.k && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-violet rounded-t" />
              )}
            </button>
          ))}
        </div>

        {tab === 'list' && (
          <>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slateqc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input-field !pl-9"
                placeholder="搜索标题、处理人、传感器..."
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {statusOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setWorkOrderFilter({ status: o.key as any })}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all',
                    workOrderFilter.status === o.key
                      ? o.key === 'ALL'
                        ? 'bg-slateqc-900 text-white'
                        : 'text-white shadow-soft'
                      : 'bg-slateqc-50 text-slateqc-500 hover:bg-slateqc-100',
                  )}
                  style={workOrderFilter.status === o.key && o.key !== 'ALL'
                    ? { background: WORK_ORDER_STATUS_COLORS[o.key as WorkOrderStatus] }
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
            <div className="flex flex-wrap gap-1.5">
              <select
                value={workOrderFilter.priority || 'ALL'}
                onChange={(e) => setWorkOrderFilter({ priority: e.target.value as any })}
                className="input-field !py-1 !text-[11px] !h-auto w-auto"
              >
                {priorityOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <select
                value={workOrderFilter.assignee || ''}
                onChange={(e) => setWorkOrderFilter({ assignee: e.target.value || undefined })}
                className="input-field !py-1 !text-[11px] !h-auto w-auto"
              >
                <option value="">全部处理人</option>
                {workOrderAssignees.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                value={workOrderFilter.sensorId || ''}
                onChange={(e) => setWorkOrderFilter({ sensorId: e.target.value || undefined })}
                className="input-field !py-1 !text-[11px] !h-auto w-auto"
              >
                <option value="">全部传感器</option>
                {sensors.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-slateqc-100 animate-pulse" />
            ))}
          </div>
        ) : tab === 'list' ? (
          filtered.length === 0 ? (
            <div className="text-center p-10">
              <ClipboardList className="w-10 h-10 mx-auto text-slateqc-200 mb-3" />
              <p className="text-slateqc-400 text-sm">
                {query || workOrderFilter.status !== 'ALL' || workOrderFilter.assignee || workOrderFilter.sensorId
                  ? '没有匹配的工单'
                  : '暂无工单，可从异常列表创建复测任务'}
              </p>
            </div>
          ) : (
            filtered.map((wo, idx) => (
              <WorkOrderCard
                key={wo.id}
                wo={wo}
                idx={idx}
                expanded={expandedId === wo.id}
                onToggle={() => setExpandedId(expandedId === wo.id ? null : wo.id)}
                onReassign={() => setReassignOpen(wo)}
                onClose={() => setCloseOpen(wo)}
                onViewHistory={async () => {
                  try {
                    const res = await api.workorders.history(wo.id);
                    setDetailHistory({ wo, history: res.data });
                  } catch { /* ignore */ }
                }}
              />
            ))
          )
        ) : (
          <div className="p-4 space-y-3 text-xs text-slateqc-600">
            <div className="p-3 rounded-xl bg-violet-50 border border-violet-100">
              <h4 className="font-bold text-slateqc-900 mb-2 flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-accent-violet" />
                工单操作说明
              </h4>
              <ul className="space-y-1.5 text-[11px]">
                <li>• 从异常列表的「拉复测工单」按钮创建工单</li>
                <li>• 同一条异常只能有一个未关闭工单（避免重复）</li>
                <li>• 状态流转：待处理 → 处理中 → 已关闭</li>
                <li>• 已关闭的工单允许撤销一次，撤销后变处理中</li>
                <li>• 撤销、改派、关闭都会写入操作历史</li>
                <li>• 筛选条件和工单数据服务重启后自动恢复</li>
              </ul>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
              <h4 className="font-bold text-slateqc-900 mb-2 flex items-center gap-1.5">
                <Flag className="w-4 h-4 text-amber-600" />
                优先级说明
              </h4>
              <ul className="space-y-1 text-[11px]">
                <li><span className="font-semibold text-red-600">紧急</span>：立即处理</li>
                <li><span className="font-semibold text-amber-600">高</span>：今日内完成</li>
                <li><span className="font-semibold text-blue-600">普通</span>：3 个工作日</li>
                <li><span className="font-semibold text-slate-500">低</span>：非紧急</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {reassignOpen && (
        <ReassignDialog
          wo={reassignOpen}
          onClose={() => setReassignOpen(null)}
        />
      )}
      {closeOpen && (
        <CloseDialog
          wo={closeOpen}
          onClose={() => setCloseOpen(null)}
        />
      )}
      {detailHistory && (
        <HistoryDialog
          wo={detailHistory.wo}
          history={detailHistory.history}
          onClose={() => setDetailHistory(null)}
        />
      )}
    </div>
  );
}

function WorkOrderCard({
  wo, idx, expanded, onToggle, onReassign, onClose, onViewHistory,
}: {
  wo: WorkOrder;
  idx: number;
  expanded: boolean;
  onToggle: () => void;
  onReassign: () => void;
  onClose: () => void;
  onViewHistory: () => void;
}) {
  const updateWorkOrderStatus = useQCStore((s) => s.updateWorkOrderStatus);
  const reopenWorkOrder = useQCStore((s) => s.reopenWorkOrder);
  const operator = localStorage.getItem('qc_last_handler') || 'system';

  const priorityColor = WORK_ORDER_PRIORITY_COLORS[wo.priority];
  const statusColor = WORK_ORDER_STATUS_COLORS[wo.status];
  const anomalyType = wo.anomaly?.type;

  return (
    <div
      style={{ animationDelay: `${Math.min(idx, 20) * 25}ms` }}
      className={cn(
        'rounded-xl border transition-all animate-fade-in overflow-hidden',
        wo.status === 'CLOSED'
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
            className="w-8 h-8 rounded-lg shrink-0 mt-0.5 flex items-center justify-center"
            style={{ background: priorityColor + '18' }}
          >
            <Flag className="w-3.5 h-3.5" style={{ color: priorityColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                style={{ background: priorityColor + '18', color: priorityColor }}
              >
                {WORK_ORDER_PRIORITY_LABELS[wo.priority]}
              </span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: statusColor + '18', color: statusColor }}
              >
                {WORK_ORDER_STATUS_LABELS[wo.status]}
              </span>
              {anomalyType && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                  style={{
                    background: ANOMALY_TYPE_COLORS[anomalyType as keyof typeof ANOMALY_TYPE_COLORS] + '18',
                    color: ANOMALY_TYPE_COLORS[anomalyType as keyof typeof ANOMALY_TYPE_COLORS],
                  }}
                >
                  {ANOMALY_TYPE_LABELS[anomalyType as keyof typeof ANOMALY_TYPE_LABELS]}
                </span>
              )}
              <span className="text-[11px] text-slateqc-400 font-mono ml-auto">
                {wo.createdAt.replace('T', ' ').substring(5, 16)}
              </span>
            </div>
            <p className="text-xs font-medium text-slateqc-800 mb-1 leading-snug line-clamp-2">
              {wo.title}
            </p>
            <div className="flex items-center gap-3 text-[11px] text-slateqc-400 flex-wrap">
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {wo.assignee}
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {wo.anomaly?.sensorName}
              </span>
              {wo.deadline && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {wo.deadline.replace('T', ' ').substring(5, 16)}
                </span>
              )}
            </div>
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
          <div className="pt-3 grid grid-cols-2 gap-2 text-[11px] mb-3">
            <div className="p-2 rounded-md bg-white border border-slateqc-100">
              <span className="text-slateqc-400 block mb-0.5">创建人</span>
              <span className="font-semibold text-slateqc-700">{wo.creator}</span>
            </div>
            <div className="p-2 rounded-md bg-white border border-slateqc-100">
              <span className="text-slateqc-400 block mb-0.5">更新时间</span>
              <span className="font-mono text-slateqc-700">{wo.updatedAt.replace('T', ' ').substring(5, 16)}</span>
            </div>
          </div>

          {wo.remark && (
            <div className="mb-3 p-2 rounded-md bg-white border border-slateqc-100">
              <div className="text-[11px] text-slateqc-400 mb-1 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                备注
              </div>
              <p className="text-[11px] text-slateqc-600 whitespace-pre-wrap leading-snug">{wo.remark}</p>
            </div>
          )}

          {wo.status === 'CLOSED' && (
            <div className="mb-3 p-2 rounded-md bg-emerald-50 border border-emerald-100">
              <div className="text-[11px] text-emerald-600 mb-1 flex items-center gap-1">
                <XCircle className="w-3 h-3" />
                关闭信息
              </div>
              <p className="text-[11px] text-slateqc-600">
                {wo.closedBy} · {wo.closedAt?.replace('T', ' ').substring(5, 16)}
                {wo.closeReason && `：${wo.closeReason}`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {wo.status === 'PENDING' && (
              <button
                onClick={() => void updateWorkOrderStatus(wo.id, { status: 'IN_PROGRESS', operator })}
                className="btn-secondary !py-1.5 !text-[11px] !px-2.5"
              >
                <Play className="w-3 h-3" />
                开始处理
              </button>
            )}
            {wo.status === 'IN_PROGRESS' && (
              <button
                onClick={() => void updateWorkOrderStatus(wo.id, { status: 'PENDING', operator })}
                className="btn-secondary !py-1.5 !text-[11px] !px-2.5"
              >
                <Pause className="w-3 h-3" />
                转待处理
              </button>
            )}
            {(wo.status === 'PENDING' || wo.status === 'IN_PROGRESS') && (
              <>
                <button
                  onClick={onReassign}
                  className="btn-secondary !py-1.5 !text-[11px] !px-2.5"
                >
                  <UserPlus className="w-3 h-3" />
                  改派
                </button>
                <button
                  onClick={onClose}
                  className="btn-primary !py-1.5 !text-[11px] !px-2.5"
                  style={{ background: WORK_ORDER_STATUS_COLORS.CLOSED }}
                >
                  <XCircle className="w-3 h-3" />
                  关闭工单
                </button>
              </>
            )}
            {wo.status === 'CLOSED' && wo.canReopen === 1 && (
              <button
                onClick={() => void reopenWorkOrder(wo.id, operator)}
                className="btn-secondary !py-1.5 !text-[11px] !px-2.5"
              >
                <Undo2 className="w-3 h-3" />
                撤销关闭
              </button>
            )}
            {wo.status === 'CLOSED' && wo.canReopen !== 1 && (
              <span className="text-[10px] text-slateqc-400 px-2 py-1.5">
                已使用撤销关闭权限
              </span>
            )}
            <button
              onClick={onViewHistory}
              className="btn-ghost !py-1.5 !text-[11px] !px-2.5 ml-auto"
            >
              <History className="w-3 h-3" />
              操作历史
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReassignDialog({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const reassignWorkOrder = useQCStore((s) => s.reassignWorkOrder);
  const [assignee, setAssignee] = useState(wo.assignee);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const operator = localStorage.getItem('qc_last_handler') || 'system';

  const doSubmit = async () => {
    if (!assignee.trim()) return;
    setSubmitting(true);
    try {
      await reassignWorkOrder(wo.id, { assignee: assignee.trim(), operator, remark: remark || undefined });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="w-11 h-11 rounded-2xl bg-blue-100 text-accent-blue flex items-center justify-center shrink-0">
            <UserPlus className="w-5.5 h-5.5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slateqc-900 text-lg mb-1">改派工单</h3>
            <p className="text-sm text-slateqc-500">将工单转给其他处理人</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 rounded-xl bg-slateqc-50 border border-slateqc-100 mb-4 space-y-1.5 text-sm">
          <div className="line-clamp-1 font-medium text-slateqc-800">{wo.title}</div>
          <div className="flex justify-between text-xs">
            <span className="text-slateqc-500">当前处理人</span>
            <span className="font-semibold text-slateqc-700">{wo.assignee}</span>
          </div>
        </div>

        <label className="label-text">新处理人</label>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="input-field mb-3"
          placeholder="新处理人姓名或工号"
        />

        <label className="label-text">改派说明（可选）</label>
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value.slice(0, 300))}
          rows={2}
          className="input-field resize-none mb-5"
          placeholder="说明改派原因"
        />

        <div className="flex gap-2">
          <button className="btn-secondary flex-1 justify-center" onClick={onClose}>取消</button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => void doSubmit()}
            disabled={submitting || !assignee.trim()}
          >
            {submitting ? '提交中...' : '确认改派'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseDialog({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const updateWorkOrderStatus = useQCStore((s) => s.updateWorkOrderStatus);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const operator = localStorage.getItem('qc_last_handler') || 'system';

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      await updateWorkOrderStatus(wo.id, { status: 'CLOSED', operator, closeReason: reason.trim() || undefined });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <XCircle className="w-5.5 h-5.5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slateqc-900 text-lg mb-1">关闭工单</h3>
            <p className="text-sm text-slateqc-500">工单关闭后允许撤销一次</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 rounded-xl bg-slateqc-50 border border-slateqc-100 mb-4">
          <div className="line-clamp-2 font-medium text-slateqc-800 text-sm">{wo.title}</div>
        </div>

        <label className="label-text flex items-center justify-between">
          关闭原因
          <span className={cn(
            'text-[10px] font-mono',
            reason.length > 250 ? 'text-accent-red' : 'text-slateqc-400',
          )}>
            {reason.length}/300
          </span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          rows={3}
          className="input-field resize-none mb-5"
          placeholder="说明复测结果、处理结论等"
        />

        <div className="flex gap-2">
          <button className="btn-secondary flex-1 justify-center" onClick={onClose}>取消</button>
          <button
            className="btn-primary flex-1 justify-center"
            style={{ background: WORK_ORDER_STATUS_COLORS.CLOSED }}
            onClick={() => void doSubmit()}
            disabled={submitting}
          >
            {submitting ? '提交中...' : '确认关闭'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryDialog({
  wo, history, onClose,
}: {
  wo: WorkOrder;
  history: WorkOrderHistory[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-slateqc-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slateqc-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slateqc-900 text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-accent-violet" />
              工单操作历史
            </h3>
            <p className="text-[11px] text-slateqc-400 font-mono mt-0.5">{wo.title}</p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3">
          {history.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 mx-auto text-slateqc-200 mb-2" />
              <p className="text-slateqc-400 text-sm">暂无操作记录</p>
            </div>
          ) : (
            history.map((h, i) => (
              <div key={h.id} className="flex gap-3" style={{ animationDelay: `${i * 30}ms` }}>
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                    <Clock className="w-3.5 h-3.5 text-accent-violet" />
                  </div>
                  {i < history.length - 1 && (
                    <div className="flex-1 w-px bg-slateqc-200 my-1" />
                  )}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-bold text-slateqc-900">
                      {WORK_ORDER_ACTION_LABELS[h.action] || h.action}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slateqc-100 text-slateqc-600">
                      {h.operator}
                    </span>
                    <span className="text-[11px] text-slateqc-400 font-mono ml-auto">
                      {h.createdAt.replace('T', ' ').substring(5, 16)}
                    </span>
                  </div>
                  {h.detail && (
                    <p className="text-xs text-slateqc-600 mb-1">{h.detail}</p>
                  )}
                  {h.beforeJson && Object.keys(h.beforeJson).length > 0 && (
                    <div className="text-[11px] text-slateqc-500">
                      <span className="text-slateqc-400">变更前：</span>
                      {JSON.stringify(h.beforeJson)}
                    </div>
                  )}
                  {h.afterJson && Object.keys(h.afterJson).length > 0 && (
                    <div className="text-[11px] text-slateqc-600">
                      <span className="text-slateqc-400">变更后：</span>
                      {JSON.stringify(h.afterJson)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

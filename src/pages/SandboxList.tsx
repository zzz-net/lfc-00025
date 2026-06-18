import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useQCStore from '@/store';
import { Plus, Copy, Trash2, Play, FileSpreadsheet, Clock, Edit3, CheckCircle, AlertTriangle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SandboxRule } from '../../shared/types.js';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700 border-amber-200',
  PUBLISHED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ARCHIVED: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function SandboxList() {
  const navigate = useNavigate();
  const sandboxRules = useQCStore((s) => s.sandboxRules);
  const loadSandboxRules = useQCStore((s) => s.loadSandboxRules);
  const createSandboxRule = useQCStore((s) => s.createSandboxRule);
  const copySandboxRule = useQCStore((s) => s.copySandboxRule);
  const deleteSandboxRule = useQCStore((s) => s.deleteSandboxRule);
  const loading = useQCStore((s) => s.loading);
  const addToast = useQCStore((s) => s.addToast);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleDesc, setNewRuleDesc] = useState('');
  const [copyFromLive, setCopyFromLive] = useState(true);
  const [operator, setOperator] = useState('');

  useEffect(() => {
    void loadSandboxRules();
    const savedOp = localStorage.getItem('qc_operator');
    if (savedOp) setOperator(savedOp);
  }, []);

  const handleCreate = async () => {
    if (!newRuleName.trim()) {
      addToast({ type: 'error', message: '请输入规则名称' });
      return;
    }
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    const rule = await createSandboxRule({
      name: newRuleName.trim(),
      description: newRuleDesc.trim(),
      copyFromLive,
      operator: op,
    });
    if (rule) {
      setShowCreateDialog(false);
      setNewRuleName('');
      setNewRuleDesc('');
      navigate(`/sandbox/${rule.id}`);
    }
  };

  const handleCopy = async (rule: SandboxRule) => {
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    const newRule = await copySandboxRule(rule.id, `${rule.name} 副本`, op);
    if (newRule) {
      navigate(`/sandbox/${newRule.id}`);
    }
  };

  const handleDelete = async (rule: SandboxRule) => {
    if (!confirm(`确定要删除规则「${rule.name}」吗？此操作不可撤销。`)) return;
    if (!operator.trim()) {
      addToast({ type: 'error', message: '请输入操作人' });
      return;
    }
    const op = operator.trim();
    localStorage.setItem('qc_operator', op);
    await deleteSandboxRule(rule.id, op);
  };

  return (
    <div className="min-h-screen bg-slateqc-50">
      <header className="h-16 shrink-0 bg-white/80 backdrop-blur border-b border-slateqc-100 flex items-center px-6 gap-4 sticky top-0 z-40">
        <button onClick={() => navigate('/')} className="text-sm text-slateqc-500 hover:text-slateqc-700">
          ← 返回看板
        </button>
        <div className="h-6 w-px bg-slateqc-200" />
        <h1 className="text-lg font-bold text-slateqc-900">规则变更演练中心</h1>
        <p className="text-xs text-slateqc-500">在不改动正式阈值的情况下演练新规，支持回放对比、误报分析、冲突检测和一键发布</p>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[11px] text-emerald-700 font-medium">所有操作强制留痕</span>
          </div>
          <input
            type="text"
            placeholder="请输入操作人 *"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className={cn(
              'w-36 px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2',
              operator.trim()
                ? 'border-slateqc-200 focus:ring-accent-blue/30'
                : 'border-red-300 bg-red-50 focus:ring-red-300/30',
            )}
          />
          <button
            onClick={() => setShowCreateDialog(true)}
            className={cn(
              'btn-primary flex items-center gap-1.5 text-xs',
              !operator.trim() && 'opacity-50 cursor-not-allowed',
            )}
            disabled={!operator.trim()}
          >
            <Plus className="w-3.5 h-3.5" />
            新建候选规则
          </button>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sandboxRules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-xl border border-slateqc-100 shadow-sm hover:shadow-md transition-shadow p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slateqc-900 truncate">{rule.name}</h3>
                  {rule.description && (
                    <p className="text-xs text-slateqc-500 mt-1 line-clamp-2">{rule.description}</p>
                  )}
                </div>
                <span className={cn(
                  'shrink-0 text-[10px] font-medium px-2 py-1 rounded-md border ml-2',
                  STATUS_COLORS[rule.status],
                )}>
                  {STATUS_LABELS[rule.status]}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slateqc-600 mb-4">
                <div className="bg-slateqc-50 rounded-lg p-2">
                  <div className="text-slateqc-400 text-[10px] mb-0.5">温度范围</div>
                  <div className="font-medium">{rule.threshold.tempMin} ~ {rule.threshold.tempMax}℃</div>
                </div>
                <div className="bg-slateqc-50 rounded-lg p-2">
                  <div className="text-slateqc-400 text-[10px] mb-0.5">湿度范围</div>
                  <div className="font-medium">{rule.threshold.humidMin} ~ {rule.threshold.humidMax}%</div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slateqc-400 mb-4">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(rule.updatedAt).toLocaleString('zh-CN')}
                </span>
                <span>创建: {rule.createdBy}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/sandbox/${rule.id}`)}
                  className="btn-secondary flex-1 flex items-center justify-center gap-1.5 text-xs"
                >
                  <Play className="w-3.5 h-3.5" />
                  打开
                </button>
                <button
                  onClick={() => handleCopy(rule)}
                  className="btn-ghost p-2 text-slateqc-500 hover:text-accent-blue hover:bg-accent-blue/10 rounded-lg"
                  title="复制规则"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(rule)}
                  className="btn-ghost p-2 text-slateqc-500 hover:text-red-500 hover:bg-red-50 rounded-lg"
                  title="删除规则"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {sandboxRules.length === 0 && !loading.sandboxRules && (
            <div className="col-span-full text-center py-16">
              <FileSpreadsheet className="w-12 h-12 text-slateqc-300 mx-auto mb-3" />
              <p className="text-sm text-slateqc-500 mb-4">还没有沙盒规则</p>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="btn-primary text-xs"
              >
                创建第一条规则
              </button>
            </div>
          )}
        </div>
      </main>

      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slateqc-900 mb-4">新建沙盒规则</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slateqc-700 mb-1.5">规则名称</label>
                <input
                  type="text"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  placeholder="例如：低温阈值测试版"
                  className="w-full px-3 py-2 text-sm border border-slateqc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slateqc-700 mb-1.5">描述（可选）</label>
                <textarea
                  value={newRuleDesc}
                  onChange={(e) => setNewRuleDesc(e.target.value)}
                  placeholder="简要说明这个规则的用途..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slateqc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30 resize-none"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slateqc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={copyFromLive}
                  onChange={(e) => setCopyFromLive(e.target.checked)}
                  className="rounded border-slateqc-300 text-accent-blue focus:ring-accent-blue/30"
                />
                从当前正式阈值复制
              </label>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  沙盒规则仅在沙盒环境中生效，不会影响正式检测。确认无误后可以发布为正式规则。
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="btn-secondary text-xs"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="btn-primary text-xs"
                disabled={!newRuleName.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import useQCStore from '@/store';
import type { ThresholdConfig } from '../../shared/types.js';
import { X, Thermometer, Droplets, TrendingUp, Clock, Shield, Save, AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ThresholdDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const thresholds = useQCStore((s) => s.thresholds);
  const update = useQCStore((s) => s.updateThresholds);
  const loading = useQCStore((s) => s.loading.thresholds);

  const [form, setForm] = useState<ThresholdConfig>(thresholds);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(thresholds);
    setDirty(false);
  }, [thresholds]);

  if (!open) return null;

  const errors: Record<string, string> = {};
  if (form.tempMin >= form.tempMax) errors.temp = '温度下限必须小于上限';
  if (form.humidMin >= form.humidMax) errors.humid = '湿度下限必须小于上限';
  if (form.tempDriftThreshold < 0) errors.tempDrift = '漂移阈值不能为负';
  if (form.humidDriftThreshold < 0) errors.humidDrift = '漂移阈值不能为负';
  if (form.gapThresholdSeconds < 1) errors.gap = '断点阈值最少1秒';
  const hasErrors = Object.keys(errors).length > 0;

  const updateField = <K extends keyof ThresholdConfig>(k: K, v: number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const reset = () => {
    setForm({
      tempMin: 15, tempMax: 30, humidMin: 30, humidMax: 70,
      tempDriftThreshold: 2, humidDriftThreshold: 10, gapThresholdSeconds: 600,
    });
    setDirty(true);
  };

  const submit = async () => {
    if (hasErrors) return;
    await update(form);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-slateqc-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col animate-fade-in"
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

        <div className="p-6 overflow-y-auto scrollbar-thin flex-1 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              disabled={loading || hasErrors || !dirty}
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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useQCStore from '@/store';
import {
  Beaker, Upload, Database, Settings, FileSpreadsheet, FileText,
  Loader2, Activity, FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ThresholdDialog from './ThresholdDialog';
import ImportDialog from './ImportDialog';

export default function TopNav() {
  const navigate = useNavigate();
  const importSample = useQCStore((s) => s.importSample);
  const sensors = useQCStore((s) => s.sensors);
  const anomalies = useQCStore((s) => s.anomalies);
  const loading = useQCStore((s) => s.loading);
  const exportReport = useQCStore((s) => s.exportReport);

  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const doExport = async (type: 'csv' | 'pdf') => {
    setExporting(type);
    try {
      await exportReport(type);
    } catch (e: any) {
      useQCStore.getState().addToast({ type: 'error', message: '导出失败: ' + e.message });
    } finally {
      setTimeout(() => setExporting(null), 500);
    }
  };

  const totalAnomalies = anomalies.length;
  const pendingCount = anomalies.filter((a) => {
    const s = a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED');
    return s === 'DETECTED' || s === 'PENDING';
  }).length;

  return (
    <>
      <header className="h-16 shrink-0 bg-white/80 backdrop-blur border-b border-slateqc-100 flex items-center px-6 gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-blue to-accent-cyan flex items-center justify-center shadow-soft">
            <Beaker className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slateqc-900 tracking-tight leading-tight">
              实验室质控看板
            </h1>
            <p className="text-[11px] text-slateqc-500 font-medium leading-tight">
              Sensor Quality Control System
            </p>
          </div>
        </div>

        <div className="h-8 w-px bg-slateqc-200 mx-2" />

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slateqc-50 border border-slateqc-100">
            <Activity className="w-3.5 h-3.5 text-accent-blue" />
            <span className="text-slateqc-600 font-semibold">{sensors.length}</span>
            <span className="text-slateqc-400">台设备</span>
          </div>
          <div className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border',
            pendingCount > 0
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700',
          )}>
            {pendingCount > 0 ? (
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            ) : (
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
            <span className="font-semibold">{pendingCount}</span>
            <span className="opacity-75">条待处理</span>
            <span className="opacity-40">/</span>
            <span className="opacity-60">{totalAnomalies}</span>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className={cn(
              'btn-secondary flex items-center gap-1.5 text-xs',
              loading.import && 'opacity-60 pointer-events-none',
            )}
            disabled={loading.import}
          >
            {loading.import ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            上传文件
          </button>

          <button
            onClick={() => void importSample()}
            className={cn(
              'btn-secondary flex items-center gap-1.5 text-xs',
              loading.import && 'opacity-60 pointer-events-none',
            )}
            disabled={loading.import}
          >
            <Database className="w-3.5 h-3.5" />
            导入样例
          </button>

          <div className="h-6 w-px bg-slateqc-200 mx-1" />

          <button
            onClick={() => navigate('/sandbox')}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            规则演练中心
          </button>

          <button
            onClick={() => setThresholdOpen(true)}
            className={cn(
              'btn-secondary flex items-center gap-1.5 text-xs',
              loading.thresholds && 'opacity-60 pointer-events-none',
            )}
            disabled={loading.thresholds}
          >
            <Settings className="w-3.5 h-3.5" />
            阈值配置
          </button>

          <div className="h-6 w-px bg-slateqc-200 mx-1" />

          <button
            onClick={() => doExport('csv')}
            className={cn(
              'btn-secondary flex items-center gap-1.5 text-xs',
              exporting === 'csv' && 'opacity-60 pointer-events-none',
            )}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            CSV报告
          </button>

          <button
            onClick={() => doExport('pdf')}
            className={cn(
              'btn-primary flex items-center gap-1.5 text-xs',
              exporting === 'pdf' && 'opacity-60 pointer-events-none',
            )}
            disabled={exporting !== null}
          >
            {exporting === 'pdf' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            导出PDF
          </button>
        </div>
      </header>

      <ThresholdDialog open={thresholdOpen} onClose={() => setThresholdOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

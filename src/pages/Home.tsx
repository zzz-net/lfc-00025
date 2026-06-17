import { useEffect, useState } from 'react';
import useQCStore from '@/store';
import TopNav from '@/components/TopNav';
import SensorList from '@/components/SensorList';
import SensorChart from '@/components/SensorChart';
import AnomalyPanel from '@/components/AnomalyPanel';
import AnnotationDialog from '@/components/AnnotationDialog';
import Toasts from '@/components/Toasts';
import type { Anomaly } from '../../shared/types.js';
import { Loader2, Database, Activity, AlertTriangle, FileCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Home() {
  const loadAll = useQCStore((s) => s.loadAll);
  const loadingAll = useQCStore((s) => s.loading.all);
  const sensors = useQCStore((s) => s.sensors);
  const anomalies = useQCStore((s) => s.anomalies);
  const annotationsHistory = useQCStore((s) => s.annotationsHistory);

  const [annotateTarget, setAnnotateTarget] = useState<Anomaly | null>(null);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const protectedCount = anomalies.filter((a) => a.hasManualOverride).length;
  const rolledBackCount = annotationsHistory.filter((h) => h.rolledBackAt).length;
  const doneCount = annotationsHistory.filter((h) => !h.rolledBackAt).length;

  return (
    <div className="h-screen w-screen flex flex-col bg-slateqc-50 overflow-hidden font-sans text-slateqc-800 antialiased">
      <TopNav />

      <div className="flex-1 flex overflow-hidden">
        {loadingAll && sensors.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-white border border-slateqc-200 shadow-soft flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-accent-blue animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slateqc-700">正在加载质控数据...</p>
                <p className="text-xs text-slateqc-400 mt-1">首次加载需要初始化 SQLite 数据库</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <aside className="w-72 shrink-0 border-r border-slateqc-200 bg-white/60 backdrop-blur">
              <SensorList />
            </aside>

            <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
                <SensorChart />

                <div className="grid grid-cols-4 gap-4">
                  <div className="card flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center">
                      <Database className="w-5 h-5 text-accent-blue" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slateqc-400">传感器</p>
                      <p className="text-xl font-bold text-slateqc-900 leading-tight">{sensors.length}</p>
                    </div>
                  </div>
                  <div className="card flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slateqc-400">异常总数</p>
                      <p className="text-xl font-bold text-slateqc-900 leading-tight">{anomalies.length}</p>
                    </div>
                  </div>
                  <div className="card flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-accent-violet/10 flex items-center justify-center">
                      <FileCheck className="w-5 h-5 text-accent-violet" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slateqc-400">人工标注</p>
                      <p className="text-xl font-bold text-slateqc-900 leading-tight">
                        {doneCount}
                        {rolledBackCount > 0 && (
                          <span className="text-xs font-medium text-slateqc-400 ml-1.5">
                            (回滚 {rolledBackCount})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="card flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slateqc-400">已保护</p>
                      <p className="text-xl font-bold text-slateqc-900 leading-tight">{protectedCount}</p>
                      <p className="text-[10px] text-slateqc-400 leading-tight">阈值重算不会覆盖</p>
                    </div>
                  </div>
                </div>
              </div>

              <StatusBar />
            </main>

            <aside className="w-[380px] shrink-0 border-l border-slateqc-200 bg-white/80 backdrop-blur flex flex-col">
              <AnomalyPanel onAnnotate={setAnnotateTarget} />
            </aside>
          </>
        )}
      </div>

      <AnnotationDialog anomaly={annotateTarget} onClose={() => setAnnotateTarget(null)} />
      <Toasts />
    </div>
  );
}

function StatusBar() {
  const sensors = useQCStore((s) => s.sensors);
  const selectedSensorId = useQCStore((s) => s.selectedSensorId);
  const statusFilter = useQCStore((s) => s.statusFilter);
  const timeRange = useQCStore((s) => s.timeRange);
  const thresholds = useQCStore((s) => s.thresholds);

  const sel = sensors.find((s) => s.id === selectedSensorId);

  return (
    <footer className={cn(
      'h-9 shrink-0 px-6 flex items-center gap-6 border-t border-slateqc-200',
      'bg-white/60 backdrop-blur text-[11px] text-slateqc-500 font-medium',
    )}>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        系统正常
      </span>
      <span className="text-slateqc-300">|</span>
      <span>当前设备：{sel ? <b className="text-slateqc-700">{sel.name}</b> : '未选择'}</span>
      <span className="text-slateqc-300">|</span>
      <span>
        状态筛选：<b className="text-slateqc-700">{statusFilter === 'ALL' ? '全部' : statusFilter}</b>
      </span>
      <span className="text-slateqc-300">|</span>
      <span>
        时间范围：<b className="text-slateqc-700">{timeRange}</b>
      </span>
      <div className="flex-1" />
      <span className="font-mono text-slateqc-400">
        阈值 T:{thresholds.tempMin}°~{thresholds.tempMax}° H:{thresholds.humidMin}%~{thresholds.humidMax}%
      </span>
    </footer>
  );
}

import useQCStore from '@/store';
import { Thermometer, AlertTriangle, MapPin, Box } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SensorList() {
  const sensors = useQCStore((s) => s.sensors);
  const selectedId = useQCStore((s) => s.selectedSensorId);
  const select = useQCStore((s) => s.selectSensor);
  const loading = useQCStore((s) => s.loading.sensors);

  if (loading && sensors.length === 0) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-slateqc-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (sensors.length === 0) {
    return (
      <div className="p-8 text-center">
        <Box className="w-12 h-12 mx-auto text-slateqc-300 mb-3" />
        <p className="text-slateqc-500 text-sm font-medium">暂无传感器</p>
        <p className="text-xs text-slateqc-400 mt-1">请先导入样例或上传数据</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto scrollbar-thin h-full">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slateqc-500 px-1 pt-1 pb-2">
        传感器列表 · {sensors.length} 台
      </h2>
      {sensors.map((s, idx) => {
        const active = s.id === selectedId;
        const hasAnomaly = (s.anomalyCount || 0) > 0;
        return (
          <button
            key={s.id}
            onClick={() => void select(s.id)}
            style={{ animationDelay: `${idx * 40}ms` }}
            className={cn(
              'w-full text-left p-4 rounded-xl transition-all duration-200 animate-fade-in',
              'border hover:shadow-soft',
              active
                ? 'sensor-card-active bg-gradient-to-br from-blue-50 to-white border-accent-blue/40'
                : 'bg-white border-slateqc-100 hover:border-slateqc-200',
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    active ? 'bg-accent-blue text-white' : 'bg-slateqc-100 text-slateqc-600',
                  )}
                >
                  <Thermometer className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3
                    className={cn(
                      'font-semibold text-sm truncate',
                      active ? 'text-accent-blue' : 'text-slateqc-900',
                    )}
                  >
                    {s.name}
                  </h3>
                  <p className="text-[11px] font-mono text-slateqc-400 truncate">{s.id}</p>
                </div>
              </div>
              {hasAnomaly ? (
                <span
                  className={cn(
                    'badge',
                    (s.pendingCount || 0) > 0
                      ? 'bg-red-100 text-red-700 animate-pulse-ring'
                      : 'bg-amber-100 text-amber-700',
                  )}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {s.anomalyCount}
                </span>
              ) : (
                s.readingCount && s.readingCount > 0 ? (
                  <span className="badge bg-emerald-50 text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    OK
                  </span>
                ) : null
              )}
            </div>

            {s.location && (
              <p className="text-xs text-slateqc-500 flex items-center gap-1 mb-2 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {s.location}
              </p>
            )}

            <div className="flex items-center gap-3 text-[11px] text-slateqc-400 font-mono">
              <span>{s.readingCount || 0} 条读数</span>
              {(s.pendingCount || 0) > 0 && (
                <span className="text-accent-red font-semibold">
                  {s.pendingCount} 待处理
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

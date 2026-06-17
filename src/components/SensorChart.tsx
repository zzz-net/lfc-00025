import { useMemo, useState } from 'react';
import useQCStore from '@/store';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Scatter, ZAxis,
} from 'recharts';
import type { AnomalyType, AnnotationStatus } from '../../shared/types.js';
import { ANOMALY_TYPE_LABELS, ANOMALY_TYPE_COLORS, STATUS_LABELS, STATUS_COLORS } from '../../shared/types.js';
import { Clock, Calendar, RefreshCw, Thermometer, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';

type TR = 'ALL' | '1H' | '24H' | '7D' | 'CUSTOM';

export default function SensorChart() {
  const selectedSensorId = useQCStore((s) => s.selectedSensorId);
  const sensors = useQCStore((s) => s.sensors);
  const readings = useQCStore((s) => s.readings);
  const anomalies = useQCStore((s) => s.anomalies);
  const thresholds = useQCStore((s) => s.thresholds);
  const loading = useQCStore((s) => s.loading.readings);
  const timeRange = useQCStore((s) => s.timeRange);
  const customStart = useQCStore((s) => s.customStart);
  const customEnd = useQCStore((s) => s.customEnd);
  const setTimeRange = useQCStore((s) => s.setTimeRange);
  const loadReadings = useQCStore((s) => s.loadReadings);

  const sensor = sensors.find((s) => s.id === selectedSensorId);

  const [cStart, setCStart] = useState(customStart ? customStart.slice(0, 16) : '');
  const [cEnd, setCEnd] = useState(customEnd ? customEnd.slice(0, 16) : '');

  const chartData = useMemo(() => {
    const anomalyMap = new Map<string, AnomalyType[]>();
    for (const a of anomalies) {
      if (!a.reading) continue;
      const key = a.reading.timestamp;
      if (!anomalyMap.has(key)) anomalyMap.set(key, []);
      anomalyMap.get(key)!.push(a.type);
    }

    const maxPoints = 600;
    const step = Math.max(1, Math.ceil(readings.length / maxPoints));

    const arr: any[] = [];
    for (let i = 0; i < readings.length; i += step) {
      const r = readings[i];
      const t = r.timestamp;
      const timeLabel = formatTimeShort(t);
      arr.push({
        timestamp: t,
        timeLabel,
        temperature: Number(r.temperature.toFixed(2)),
        humidity: Number(r.humidity.toFixed(1)),
        anomalies: anomalyMap.get(t) || [],
        hasAnomaly: (anomalyMap.get(t)?.length || 0) > 0,
      });
    }
    return arr;
  }, [readings, anomalies]);

  const anomalyScatterData = useMemo(() => {
    const list: any[] = [];
    chartData.forEach((d, idx) => {
      if (d.anomalies?.length > 0) {
        const status = getStatusForTime(d.timestamp, anomalies);
        d.anomalies.forEach((type: AnomalyType) => {
          const isTemp = type.includes('TEMP') || type === 'DATA_GAP';
          list.push({
            idx,
            name: d.timeLabel,
            value: isTemp ? d.temperature : d.humidity,
            type,
            status,
            size: 80 + d.anomalies.length * 20,
          });
        });
      }
    });
    return list;
  }, [chartData, anomalies]);

  if (!sensor) {
    return (
      <div className="card p-10 text-center h-full min-h-[420px] flex items-center justify-center">
        <div>
          <Thermometer className="w-16 h-16 mx-auto text-slateqc-200 mb-4" />
          <h3 className="text-slateqc-600 font-semibold mb-1">选择一台传感器</h3>
          <p className="text-sm text-slateqc-400">从左侧列表选择以查看温湿度趋势</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 h-full flex flex-col animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-slateqc-900">{sensor.name}</h2>
            <span className="font-mono text-xs text-slateqc-400">{sensor.id}</span>
          </div>
          <p className="text-xs text-slateqc-500 flex items-center gap-3">
            {sensor.location && <span>📍 {sensor.location}</span>}
            <span className="flex items-center gap-1">
              <Thermometer className="w-3 h-3 text-accent-orange" />
              {thresholds.tempMin}~{thresholds.tempMax}℃
            </span>
            <span className="flex items-center gap-1">
              <Droplets className="w-3 h-3 text-accent-cyan" />
              {thresholds.humidMin}~{thresholds.humidMax}%
            </span>
            <span className="font-mono text-slateqc-400">{readings.length} 点</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', '1H', '24H', '7D'] as TR[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                timeRange === r
                  ? 'bg-accent-blue text-white shadow-soft'
                  : 'bg-slateqc-50 text-slateqc-600 hover:bg-slateqc-100',
              )}
            >
              {r === 'ALL' && <Calendar className="w-3 h-3 inline mr-1" />}
              {r === '1H' && '1小时'}
              {r === '24H' && '24小时'}
              {r === '7D' && '7天'}
              {r === 'ALL' && '全部'}
            </button>
          ))}
          <button
            onClick={() => setTimeRange('CUSTOM', cStart ? new Date(cStart).toISOString() : undefined, cEnd ? new Date(cEnd).toISOString() : undefined)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1',
              timeRange === 'CUSTOM' ? 'bg-accent-blue text-white' : 'bg-slateqc-50 text-slateqc-600 hover:bg-slateqc-100',
            )}
          >
            <Clock className="w-3 h-3" />
            自定义
          </button>
          {timeRange === 'CUSTOM' && (
            <div className="flex items-center gap-1 text-xs">
              <input
                type="datetime-local"
                className="px-2 py-1 rounded-md border border-slateqc-200 font-mono w-40"
                value={cStart}
                onChange={(e) => setCStart(e.target.value)}
              />
              <span className="text-slateqc-400">~</span>
              <input
                type="datetime-local"
                className="px-2 py-1 rounded-md border border-slateqc-200 font-mono w-40"
                value={cEnd}
                onChange={(e) => setCEnd(e.target.value)}
              />
            </div>
          )}
          <button
            onClick={() => selectedSensorId && loadReadings(selectedSensorId)}
            className="btn-ghost !p-2"
            title="刷新"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {loading && readings.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-slateqc-200 border-t-accent-blue rounded-full animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slateqc-400 text-sm">
            该时间范围内无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F97316" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="humidGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" strokeWidth={0.8} />
              <XAxis
                dataKey="timeLabel"
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#CBD5E1' }}
                minTickGap={32}
              />
              <YAxis
                yAxisId="temp"
                tick={{ fontSize: 11, fill: '#F97316', fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#F97316' }}
                label={{ value: '℃', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#F97316' }}
                domain={['auto', 'auto']}
                width={50}
              />
              <YAxis
                yAxisId="humid"
                orientation="right"
                tick={{ fontSize: 11, fill: '#06B6D4', fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#06B6D4' }}
                label={{ value: '%', angle: 90, position: 'insideRight', fontSize: 12, fill: '#06B6D4' }}
                domain={['auto', 'auto']}
                width={50}
              />
              <Tooltip
                content={CustomTooltip}
                cursor={{ strokeDasharray: '3 3', stroke: '#94A3B8' }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />

              <ReferenceLine yAxisId="temp" y={thresholds.tempMax} stroke="#EF4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: '温上限', position: 'right', fontSize: 10, fill: '#EF4444' }} />
              <ReferenceLine yAxisId="temp" y={thresholds.tempMin} stroke="#8B5CF6" strokeDasharray="4 4" strokeWidth={1} label={{ value: '温下限', position: 'right', fontSize: 10, fill: '#8B5CF6' }} />
              <ReferenceLine yAxisId="humid" y={thresholds.humidMax} stroke="#F97316" strokeDasharray="4 4" strokeWidth={1} label={{ value: '湿上限', position: 'right', fontSize: 10, fill: '#F97316' }} />
              <ReferenceLine yAxisId="humid" y={thresholds.humidMin} stroke="#EC4899" strokeDasharray="4 4" strokeWidth={1} label={{ value: '湿下限', position: 'right', fontSize: 10, fill: '#EC4899' }} />

              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name="温度 ℃"
                stroke="#F97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="humid"
                type="monotone"
                dataKey="humidity"
                name="湿度 %"
                stroke="#06B6D4"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
              />

              <ZAxis type="number" dataKey="size" range={[60, 200]} />
              <Scatter
                yAxisId="temp"
                name="温度相关异常"
                data={anomalyScatterData.filter((d) => d.type.includes('TEMP') || d.type === 'DATA_GAP')}
                isAnimationActive={false}
                shape={(props: any) => <AnomalyDot {...props} />}
              />
              <Scatter
                yAxisId="humid"
                name="湿度相关异常"
                data={anomalyScatterData.filter((d) => d.type.includes('HUMID'))}
                isAnimationActive={false}
                shape={(props: any) => <AnomalyDot {...props} />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

function getStatusForTime(_t: string, anomalies: any[]): AnnotationStatus {
  for (const a of anomalies) {
    if (a.latestAnnotation && !a.latestAnnotation.rolledBackAt) {
      return a.latestAnnotation.status;
    }
  }
  return 'DETECTED';
}

function AnomalyDot(props: any) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;
  const color = ANOMALY_TYPE_COLORS[payload.type as AnomalyType] || '#EF4444';
  const statusColor = STATUS_COLORS[payload.status as AnnotationStatus];
  return (
    <g style={{ cursor: 'pointer' }}>
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={color}
        stroke="#fff"
        strokeWidth={2}
        style={{
          filter: payload.status !== 'DETECTED'
            ? `drop-shadow(0 0 4px ${statusColor})`
            : `drop-shadow(0 0 6px ${color})`,
          opacity: payload.status === 'FALSE_POSITIVE' ? 0.35 : 1,
        }}
      />
      {payload.status === 'ACCEPTED' && (
        <circle cx={cx} cy={cy} r={3} fill="#10B981" stroke="#fff" strokeWidth={1} />
      )}
      {payload.status === 'PENDING' && (
        <rect x={cx - 3} y={cy - 3} width={6} height={6} fill="#F59E0B" stroke="#fff" strokeWidth={1} />
      )}
      {payload.status === 'RETEST' && (
        <polygon points={`${cx},${cy - 4} ${cx + 3.5},${cy + 2.5} ${cx - 3.5},${cy + 2.5}`} fill="#3B82F6" stroke="#fff" strokeWidth={1} />
      )}
    </g>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const temp = payload.find((p: any) => p.dataKey === 'temperature');
  const humid = payload.find((p: any) => p.dataKey === 'humidity');
  const scatterItems = payload.filter((p: any) => p.payload?.hasAnomaly && p.payload?.anomalies?.length > 0);
  const anoms = scatterItems.length > 0
    ? scatterItems
    : (temp?.payload?.anomalies || humid?.payload?.anomalies || []).map((type: AnomalyType) => ({ payload: { type, status: 'DETECTED' } }));

  const uniqueAnoms = new Map();
  for (const a of anoms) {
    const t = a.type || a.payload?.type;
    if (t && !uniqueAnoms.has(t)) uniqueAnoms.set(t, a.payload?.status || 'DETECTED');
  }

  return (
    <div className="bg-white/95 backdrop-blur rounded-xl shadow-card border border-slateqc-100 p-3 min-w-[220px] animate-fade-in">
      <p className="font-mono text-xs text-slateqc-500 mb-2">{label}</p>
      {temp && (
        <div className="flex items-center justify-between mb-1">
          <span className="flex items-center gap-1.5 text-sm">
            <span className="w-3 h-3 rounded-full bg-accent-orange" />
            温度
          </span>
          <span className="font-mono font-bold text-accent-orange">{temp.value}℃</span>
        </div>
      )}
      {humid && (
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-sm">
            <span className="w-3 h-3 rounded-full bg-accent-cyan" />
            湿度
          </span>
          <span className="font-mono font-bold text-accent-cyan">{humid.value}%</span>
        </div>
      )}
      {uniqueAnoms.size > 0 && (
        <>
          <div className="h-px bg-slateqc-100 my-2" />
          <p className="text-[11px] uppercase font-bold text-slateqc-400 tracking-wider mb-1.5">
            异常标记
          </p>
          <div className="space-y-1.5">
            {Array.from(uniqueAnoms.entries()).map(([type, status]) => (
              <div key={type} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs">
                  <span
                    className="anomaly-dot"
                    style={{ background: ANOMALY_TYPE_COLORS[type as AnomalyType] }}
                  />
                  {ANOMALY_TYPE_LABELS[type as AnomalyType]}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{
                    background: STATUS_COLORS[status as AnnotationStatus] + '22',
                    color: STATUS_COLORS[status as AnnotationStatus],
                  }}
                >
                  {STATUS_LABELS[status as AnnotationStatus]}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

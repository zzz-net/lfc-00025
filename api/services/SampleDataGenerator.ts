import Papa from 'papaparse';
import type { Sensor, Reading } from '../../shared/types.js';

interface SampleSensor {
  id: string;
  name: string;
  location: string;
  model: string;
  baseTemp: number;
  baseHumid: number;
}

const SAMPLE_SENSORS: SampleSensor[] = [
  { id: 'SENS-001', name: '一号冷库', location: 'A栋101室', model: 'TH-Pro-X1', baseTemp: 4.5, baseHumid: 55 },
  { id: 'SENS-002', name: '试剂保存室', location: 'A栋102室', model: 'TH-Pro-X1', baseTemp: 8.0, baseHumid: 45 },
  { id: 'SENS-003', name: '细胞培养箱', location: 'B栋201室', model: 'TH-Pro-X2', baseTemp: 37.0, baseHumid: 95 },
  { id: 'SENS-004', name: '常温试剂柜', location: 'B栋205室', model: 'TH-Basic', baseTemp: 22.0, baseHumid: 40 },
  { id: 'SENS-005', name: '稳定性试验箱', location: 'C栋301室', model: 'TH-Stab-500', baseTemp: 25.0, baseHumid: 60 },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateSampleCsv(): string {
  const rows: Record<string, any>[] = [];
  const rand = seededRandom(20240601);
  const now = new Date();
  const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const s of SAMPLE_SENSORS) {
    let t = new Date(startTime);
    let idx = 0;
    let prevTemp = s.baseTemp;
    let prevHumid = s.baseHumid;

    while (t.getTime() <= now.getTime()) {
      let temp = s.baseTemp + (rand() - 0.5) * 0.8;
      let humid = s.baseHumid + (rand() - 0.5) * 4;

      if (idx % 37 === 13) {
        temp = s.baseTemp + 3.5 + rand() * 2;
      }
      if (idx % 73 === 42) {
        temp = s.baseTemp - 3.5 - rand() * 2;
      }
      if (idx % 59 === 18) {
        humid = Math.min(100, s.baseHumid + 18);
      }
      if (idx % 89 === 30) {
        humid = Math.max(0, s.baseHumid - 18);
      }

      if (idx % 101 === 57) {
        temp = prevTemp + (rand() > 0.5 ? 4 : -4) * rand();
      }
      if (idx % 113 === 72) {
        humid = prevHumid + (rand() > 0.5 ? 18 : -18);
      }

      if (s.id === 'SENS-003' && idx % 277 === 200) {
        t = new Date(t.getTime() + 35 * 60 * 1000);
      }
      if (s.id === 'SENS-005' && idx % 389 === 150) {
        t = new Date(t.getTime() + 25 * 60 * 1000);
      }

      rows.push({
        sensorId: s.id,
        sensorName: s.name,
        location: s.location,
        model: s.model,
        timestamp: t.toISOString().replace('T', ' ').substring(0, 19),
        temperature: Number(temp.toFixed(2)),
        humidity: Number(humid.toFixed(1)),
      });

      prevTemp = temp;
      prevHumid = humid;
      t = new Date(t.getTime() + 5 * 60 * 1000);
      idx++;
    }
  }

  for (let i = 0; i < 3; i++) {
    rows.push({
      sensorId: 'SENS-001',
      sensorName: '一号冷库',
      location: 'A栋101室',
      model: 'TH-Pro-X1',
      timestamp: 'not-a-date-' + i,
      temperature: 'abc',
      humidity: 50,
    });
  }

  return Papa.unparse(rows);
}

export function getSampleSensors(): Sensor[] {
  return SAMPLE_SENSORS.map((s) => ({
    id: s.id,
    name: s.name,
    location: s.location,
    model: s.model,
    createdAt: new Date().toISOString(),
  }));
}

export { SAMPLE_SENSORS };

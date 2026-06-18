import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = path.resolve(__dirname, '..', 'test-runtime');
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const TEST_DB = path.join(TEST_DATA_DIR, 'test_regression.db');

function setupEnv() {
  if (!fs.existsSync(TEST_ROOT)) fs.mkdirSync(TEST_ROOT, { recursive: true });
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  process.env.QC_DATA_DIR = TEST_DATA_DIR;
  process.env.QC_DB_PATH = TEST_DB;
}

setupEnv();

async function loadModules() {
  const ImportSvc = await import('../api/services/ImportService.js');
  const ReportSvc = await import('../api/services/ReportService.js');
  const SensorRepo = await import('../api/repositories/SensorRepo.js');
  const AnomalyRepo = await import('../api/repositories/AnomalyRepo.js');
  const AnnotationRepo = await import('../api/repositories/AnnotationRepo.js');
  const ConfigRepo = await import('../api/repositories/ConfigRepo.js');
  const DataDb = await import('../api/data/db.js');
  const fileHash = await import('../api/utils/fileHash.js');
  return {
    importSampleData: ImportSvc.importSampleData,
    generateCsvReport: ReportSvc.generateCsvReport,
    findAllSensors: SensorRepo.findAllSensors,
    findAllAnomalies: AnomalyRepo.findAllAnomalies,
    findAnomalyById: AnomalyRepo.findAnomalyById,
    insertAnnotation: AnnotationRepo.insertAnnotation,
    rollbackLatestAnnotation: AnnotationRepo.rollbackLatestAnnotation,
    findAnnotationHistory: AnnotationRepo.findAnnotationHistory,
    getAppState: ConfigRepo.getAppState,
    saveAppState: ConfigRepo.saveAppState,
    getThresholdConfig: ConfigRepo.getThresholdConfig,
    updateThresholdConfig: ConfigRepo.updateThresholdConfig,
    generateId: fileHash.generateId,
    db: DataDb.db,
  };
}

type Mods = Awaited<ReturnType<typeof loadModules>>;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.replace(/^"|"$/g, '').trim());
}

function parseCsvRows(csv: string): Record<string, string>[] {
  const firstSep = csv.indexOf('=====');
  const anomalySection = firstSep >= 0 ? csv.substring(0, firstSep) : csv;
  const lines = anomalySection.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c.length === 0)) continue;
    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = (cells[k] || '').trim();
    rows.push(obj);
  }
  return rows;
}

interface CsvThresholdRow {
  key: string;
  value: number;
  label: string;
}

function parseCsvThresholdSection(csv: string): {
  meta: { exportedAt?: string; filter?: string };
  rows: CsvThresholdRow[];
  present: boolean;
} {
  const marker = '===== 报告生成时生效的阈值配置 =====';
  const start = csv.indexOf(marker);
  const result: { meta: { exportedAt?: string; filter?: string }; rows: CsvThresholdRow[]; present: boolean } = {
    meta: {},
    rows: [],
    present: start >= 0,
  };
  if (start < 0) return result;
  const afterMarker = csv.substring(start + marker.length);
  const nextSection = afterMarker.indexOf('=====');
  const section = nextSection >= 0 ? afterMarker.substring(0, nextSection) : afterMarker;
  const lines = section.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      const m1 = line.match(/^#\s*导出时间[:：]\s*(.+)$/);
      if (m1) result.meta.exportedAt = m1[1].trim();
      const m2 = line.match(/^#\s*筛选条件[:：]\s*(.+)$/);
      if (m2) result.meta.filter = m2[1].trim();
      continue;
    }
    if (line.includes('配置项') && (line.includes('数值') || line.includes('说明'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return result;
  const headers = splitCsvLine(lines[headerIdx]);
  const keyIdx = headers.indexOf('配置项');
  const valIdx = headers.indexOf('数值');
  const labelIdx = headers.indexOf('说明');
  if (keyIdx < 0 || valIdx < 0) return result;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c.length === 0)) continue;
    const key = cells[keyIdx] || '';
    const valRaw = cells[valIdx] || '';
    const val = Number(valRaw);
    if (!key || Number.isNaN(val)) continue;
    result.rows.push({
      key,
      value: val,
      label: labelIdx >= 0 ? (cells[labelIdx] || '') : '',
    });
  }
  return result;
}

describe('硬伤回归：生产启动链路 + 筛选导出一致性', () => {
  let m: Mods;

  before(async () => {
    m = await loadModules();
  });

  after(() => {
    for (const f of [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal']) {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  // ========== 硬伤1：生产启动链路 ==========
  describe('1. 生产启动链路（README 命令可实际运行）', () => {
    it('项目根目录必须存在 package.json 且 start 脚本存在', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
      assert.ok(pkg.scripts?.start, '"npm start" 脚本必须存在');
      assert.ok(typeof pkg.scripts.start === 'string', 'start 必须是字符串');
      assert.ok(
        pkg.scripts.start.includes('server:start') || pkg.scripts.start.includes('api/server'),
        'start 脚本应最终启动 api/server.ts',
      );
    });

    it('cross-env 必须在 dependencies 中声明（新装环境 npm install 后立即可用）', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
      assert.ok(
        (pkg.dependencies && pkg.dependencies['cross-env'])
        || (pkg.devDependencies && pkg.devDependencies['cross-env']),
        'cross-env 必须在 package.json 依赖中声明',
      );
      const targetPath = path.join(PROJECT_ROOT, 'node_modules', 'cross-env', 'package.json');
      assert.ok(fs.existsSync(targetPath),
        'cross-env 实际应已安装到 node_modules（路径：' + targetPath + '）');
    });

    it('dist/index.html 必须在 npm run build 后存在（构建产物链路完整）', () => {
      // 本测试假设之前已经 npm run build 过（上一轮 CI/本会话执行过）
      // 如果不存在，说明生产链路缺 build 步骤，是硬伤
      const distIndex = path.join(PROJECT_ROOT, 'dist', 'index.html');
      assert.ok(fs.existsSync(distIndex),
        `dist/index.html 必须存在（${distIndex}），生产启动前必须 npm run build`);
    });

    it('api/app.ts 在 NODE_ENV=production 时必须会 serve dist/ 静态文件', () => {
      const appSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'api', 'app.ts'), 'utf-8');
      assert.match(appSrc, /NODE_ENV\s*===\s*['"]production['"]/,
        'app.ts 必须判断 production 环境');
      assert.match(appSrc, /express\.static/,
        'app.ts 必须调用 express.static 提供静态文件');
      assert.match(appSrc, /dist/,
        'app.ts 必须指向 dist/ 目录作为静态根');
    });

    it('生产环境子进程真实可启动（实际 spawn 检查端口监听）', (t, done) => {
      const tsxCliPath = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      assert.ok(fs.existsSync(tsxCliPath), 'tsx CLI 必须存在：' + tsxCliPath);
      const child = spawn(
        process.execPath,
        [tsxCliPath, path.join(PROJECT_ROOT, 'api', 'server.ts')],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: '3188',
            QC_DATA_DIR: TEST_DATA_DIR,
            QC_DB_PATH: TEST_DB,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ) as ChildProcess;
      let out = '';
      child.stdout!.on('data', (d) => { out += d.toString(); });
      child.stderr!.on('data', (d) => { out += d.toString(); });
      let finished = false;
      const to = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        done(new Error('启动超时：5s 内未输出 "Server ready"\nOutput: ' + out.slice(-500)));
      }, 10000);
      const checkInt = setInterval(() => {
        if (out.includes('Server ready') || out.includes('Server ready on port')) {
          if (finished) return;
          finished = true;
          clearTimeout(to);
          clearInterval(checkInt);
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
          assert.ok(out.includes('production'), '应显示 NODE_ENV=production');
          assert.match(out, /port 3188/, '应在指定端口监听');
          done();
        }
      }, 100);
      child.on('exit', () => {
        clearInterval(checkInt);
        if (!finished) {
          finished = true;
          clearTimeout(to);
          done(new Error('子进程提前退出\nOutput: ' + out.slice(-500)));
        }
      });
    }, { timeout: 20000 });
  });

  // ========== 硬伤2：筛选导出一致性 ==========
  describe('2. 异常列表筛选与 CSV 导出完全对齐', () => {
    before(() => {
      const res = m.importSampleData();
      assert.ok(res.success, '样例导入成功');
    });

    it('时间范围收敛：findAllAnomalies 传入 start/end 只返回范围内异常', () => {
      const all = m.findAllAnomalies();
      assert.ok(all.length > 0, '先有全量异常');
      // 样例数据 2025-05-01 ~ 2025-05-07
      const onlyFirst2Days = m.findAllAnomalies(undefined, 'ALL', {
        start: '2025-05-01T00:00:00.000Z',
        end: '2025-05-02T23:59:59.999Z',
      });
      assert.ok(onlyFirst2Days.length < all.length,
        `限定时间范围后条数应减少：${onlyFirst2Days.length} vs ${all.length}`);
      for (const a of onlyFirst2Days) {
        assert.ok(a.reading?.timestamp, '每条异常应有 reading.timestamp');
        const ts = new Date(a.reading!.timestamp).getTime();
        assert.ok(
          ts >= new Date('2025-05-01T00:00:00.000Z').getTime()
          && ts <= new Date('2025-05-02T23:59:59.999Z').getTime(),
          `异常 ${a.id} 时间 ${a.reading?.timestamp} 应在 05-01~05-02 内`,
        );
      }
    });

    it('单传感器筛选：findAllAnomalies(sensorId) 与导出 CSV 条数完全一致', () => {
      const sensors = m.findAllSensors();
      const target = sensors[1];
      assert.ok(target && target.id, '至少要有两个传感器');
      const uiList = m.findAllAnomalies(target.id);
      assert.ok(uiList.length > 0, `${target.id} 应有异常`);
      // 导出时传相同 filter
      const csv = m.generateCsvReport({ sensorId: target.id });
      const rows = parseCsvRows(csv);
      // 异常明细：直到空行/标注历史分隔前的有效数据行（非"===== 标注历史"）
      const anomalyRows = rows.filter((r) => r['传感器ID'] && r['传感器ID'].trim().length > 0);
      for (const r of anomalyRows) {
        assert.equal(r['传感器ID'], target.id,
          `CSV 每条异常传感器应为 ${target.id}，实际 ${r['传感器ID']}`);
      }
      assert.equal(anomalyRows.length, uiList.length,
        `CSV 异常明细条数应等于界面 findAllAnomalies(${target.id})：${anomalyRows.length} vs ${uiList.length}`);
    });

    it('已接受状态筛选：界面条数 = 导出 CSV 条数，不得混入待处理', () => {
      const sensors = m.findAllSensors();
      const target = sensors[0];
      // 先人为标注 3 条为 ACCEPTED
      const candidates = m.findAllAnomalies(target.id, 'DETECTED');
      assert.ok(candidates.length >= 3, `至少有 3 条可标注的待处理（实际 ${candidates.length}）`);
      for (let i = 0; i < 3; i++) {
        m.insertAnnotation({
          id: m.generateId('ann_reg_'),
          anomalyId: candidates[i].id,
          status: 'ACCEPTED',
          handler: '回归测试员',
          reason: `第${i + 1}条已接受`,
        });
      }
      // 只看已接受
      const uiAccepted = m.findAllAnomalies(target.id, 'ACCEPTED');
      assert.ok(uiAccepted.length >= 3, '标注后至少 3 条已接受');
      for (const a of uiAccepted) {
        assert.equal(
          a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED'),
          'ACCEPTED',
          `每条筛选结果状态必须是 ACCEPTED（${a.id}）`,
        );
      }
      // 导出同样筛选条件
      const csv = m.generateCsvReport({ sensorId: target.id, statusFilter: 'ACCEPTED' });
      const rows = parseCsvRows(csv).filter((r) => r['传感器ID'] && r['传感器ID'].trim().length > 0);
      assert.equal(rows.length, uiAccepted.length,
        `CSV 已接受筛选条数 = 界面条数：${rows.length} vs ${uiAccepted.length}`);
      for (const r of rows) {
        assert.equal(r['当前状态'], '已接受',
          `CSV 当前状态列必须是"已接受"，实际：${r['当前状态']}`);
        assert.equal(r['传感器ID'], target.id,
          `CSV 传感器ID必须等于筛选值`);
      }
    });

    it('传感器 + 状态 + 时间范围 三重筛选：界面与 CSV 完全一致', () => {
      const sensors = m.findAllSensors();
      const target = sensors[2];
      assert.ok(target);
      // 三重过滤
      const filter = {
        sensorId: target.id,
        statusFilter: 'ALL' as const,
        timeRange: { start: '2025-05-01T00:00:00.000Z', end: '2025-05-03T23:59:59.999Z' },
      };
      const ui = m.findAllAnomalies(filter.sensorId, filter.statusFilter, filter.timeRange);
      assert.ok(ui.length > 0, '三重过滤后仍应有异常');
      const csv = m.generateCsvReport(filter);
      const rows = parseCsvRows(csv).filter((r) => r['传感器ID'] && r['传感器ID'].trim().length > 0);
      assert.equal(rows.length, ui.length,
        `三重筛选 CSV 条数 = 界面条数：${rows.length} vs ${ui.length}`);
      // 逐条校验
      for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i]['传感器ID'], target.id, `#${i} 传感器匹配`);
        const ts = new Date(rows[i]['读数时间']).getTime();
        assert.ok(
          ts >= new Date(filter.timeRange.start!).getTime()
          && ts <= new Date(filter.timeRange.end!).getTime(),
          `#${i} 时间 ${rows[i]['读数时间']} 在范围外`,
        );
      }
    });
  });

  // ========== 硬伤3：跨重启导出不漂 ==========
  describe('3. 跨重启导出一致性：saveAppState 持久化筛选 → 恢复后再导出内容不漂', () => {
    it('saveAppState 存 customStart/customEnd + 重启恢复后导出 CSV 与保存前完全一致', () => {
      const sensors = m.findAllSensors();
      const target = sensors[0];
      const customStart = '2025-05-02T00:00:00.000Z';
      const customEnd = '2025-05-04T23:59:59.999Z';

      // 先人为标 1 条 ACCEPTED 便于过滤
      const candidates = m.findAllAnomalies(target.id, 'DETECTED');
      if (candidates.length > 0) {
        m.insertAnnotation({
          id: m.generateId('ann_xr_'),
          anomalyId: candidates[0].id,
          status: 'ACCEPTED',
          handler: '跨重启验证',
          reason: '跨重启验证：这条必须保留',
        });
      }

      // 保存筛选到 app_state
      const saved = m.saveAppState({
        selectedSensorId: target.id,
        statusFilter: 'ACCEPTED',
        timeRange: 'CUSTOM',
        customStart,
        customEnd,
        view: {},
      });
      assert.equal(saved.selectedSensorId, target.id);
      assert.equal(saved.statusFilter, 'ACCEPTED');
      assert.equal(saved.timeRange, 'CUSTOM');
      assert.equal(saved.customStart, customStart);
      assert.equal(saved.customEnd, customEnd);

      // 第一次导出（模拟重启前）
      const csv1 = m.generateCsvReport({
        sensorId: saved.selectedSensorId ?? undefined,
        statusFilter: saved.statusFilter,
        timeRange: saved.timeRange === 'CUSTOM'
          ? { start: saved.customStart, end: saved.customEnd }
          : undefined,
      });

      // 模拟「重启」：再读一次 appState（相当于重启后 GET /api/state）
      const restored = m.getAppState();
      assert.equal(restored.selectedSensorId, saved.selectedSensorId);
      assert.equal(restored.statusFilter, saved.statusFilter);
      assert.equal(restored.timeRange, saved.timeRange);
      assert.equal(restored.customStart, saved.customStart);
      assert.equal(restored.customEnd, saved.customEnd);

      // 第二次导出（模拟重启后）
      const csv2 = m.generateCsvReport({
        sensorId: restored.selectedSensorId ?? undefined,
        statusFilter: restored.statusFilter,
        timeRange: restored.timeRange === 'CUSTOM'
          ? { start: restored.customStart, end: restored.customEnd }
          : undefined,
      });

      // 逐行比对（去掉时间戳和文件名等元数据，只比数据）
      const rows1 = parseCsvRows(csv1).filter((r) => r['异常ID']);
      const rows2 = parseCsvRows(csv2).filter((r) => r['异常ID']);
      assert.equal(rows1.length, rows2.length,
        `跨重启导出条数必须一致：${rows1.length} vs ${rows2.length}`);
      for (let i = 0; i < rows1.length; i++) {
        assert.equal(rows1[i]['异常ID'], rows2[i]['异常ID'], `#${i} 异常ID一致`);
        assert.equal(rows1[i]['传感器ID'], rows2[i]['传感器ID'], `#${i} 传感器一致`);
        assert.equal(rows1[i]['当前状态'], rows2[i]['当前状态'], `#${i} 状态一致`);
        assert.equal(rows1[i]['处理人'], rows2[i]['处理人'], `#${i} 处理人一致`);
        assert.equal(rows1[i]['处理原因'], rows2[i]['处理原因'], `#${i} 原因一致`);
      }
    });
  });

  // ========== 硬伤4：首页统计被放大到数百万 ==========
  describe('4. 首页/传感器卡片统计必须与 SQLite ground truth 完全一致', () => {
    before(() => {
      // 如果前面套件已经导入过样例（findAllSensors 有数据），就不重复导入，避免 file_hash 去重拒绝
      const existing = m.findAllSensors();
      if (existing.length === 0) {
        const res = m.importSampleData();
        assert.ok(res.success, '首次导入样例必须成功');
      }
      // 兜底：再次确认有数据
      const sensors = m.findAllSensors();
      assert.ok(sensors.length > 0, '导入后至少 1 台传感器');
    });

    it('每台传感器 readingCount = SELECT COUNT(*) FROM readings WHERE sensor_id = X', () => {
      const sensors = m.findAllSensors();
      assert.ok(sensors.length > 0, '至少有一台传感器');
      let sumAll = 0;
      for (const s of sensors) {
        const gt = (m.db as any).prepare('SELECT COUNT(*) as c FROM readings WHERE sensor_id = ?').get(s.id).c;
        assert.equal(s.readingCount, gt,
          `${s.id} readingCount 必须是 SQLite 实际行数 ${gt}，实际返回 ${s.readingCount}`);
        // 断言不能是百万级（旧 bug 特征：R × A 乘积）
        assert.ok(s.readingCount < 1_000_000,
          `${s.id} readingCount 不可能达到百万级（${s.readingCount}），疑似笛卡尔积放大`);
        sumAll += s.readingCount;
      }
      const gtTotal = (m.db as any).prepare('SELECT COUNT(*) as c FROM readings').get().c;
      assert.equal(sumAll, gtTotal, `所有传感器 readingCount 汇总 = 表总行数 ${gtTotal}`);
    });

    it('每台传感器 anomalyCount / pendingCount 不能超过该传感器 anomalies 总行数，且不被放大', () => {
      const sensors = m.findAllSensors();
      for (const s of sensors) {
        const gt = (m.db as any).prepare('SELECT COUNT(*) as c FROM anomalies WHERE sensor_id = ?').get(s.id).c;
        assert.ok(s.anomalyCount <= gt,
          `${s.id} anomalyCount(${s.anomalyCount}) 不能超过 anomalies 总行数(${gt})`);
        assert.ok(s.pendingCount <= gt,
          `${s.id} pendingCount(${s.pendingCount}) 不能超过 anomalies 总行数(${gt})`);
        assert.ok(s.anomalyCount < 1_000_000,
          `${s.id} anomalyCount(${s.anomalyCount}) 不可能百万级`);
        assert.ok(s.pendingCount < 1_000_000,
          `${s.id} pendingCount(${s.pendingCount}) 不可能百万级`);
      }
    });

    it('样例数据总行数必须与设计一致：约 1 万读数 / 约 1 万异常', () => {
      const totalReadings = (m.db as any).prepare('SELECT COUNT(*) as c FROM readings').get().c;
      const totalAnomalies = (m.db as any).prepare('SELECT COUNT(*) as c FROM anomalies').get().c;
      assert.ok(totalReadings >= 9000 && totalReadings <= 12000,
        `样例读数总行数应约 1 万，实际 ${totalReadings}`);
      assert.ok(totalAnomalies >= 5000 && totalAnomalies <= 20000,
        `样例异常总行数应数千~1 万，实际 ${totalAnomalies}`);
      const sensors = m.findAllSensors();
      const sumR = sensors.reduce((a, b) => a + b.readingCount, 0);
      assert.ok(sumR >= 9000 && sumR <= 12000,
        `findAllSensors 汇总 readingCount 应约 1 万，实际 ${sumR}`);
    });

    it('❌ buggy SQL（无 DISTINCT）必须至少放大 10 倍，✅ 当前 SQL 必须无放大（复现特征锁定）', () => {
      // 故意执行旧 buggy 写法，验证复现特征依然存在（防止有人误以为 DISTINCT 是多余的而删掉）
      const buggy = (m.db as any).prepare(`
        SELECT s.id, COUNT(r.id) as c
        FROM sensors s
        LEFT JOIN readings r ON r.sensor_id = s.id
        LEFT JOIN anomalies a ON a.sensor_id = s.id
        GROUP BY s.id
      `).all() as any[];
      const gt = (m.db as any).prepare(`
        SELECT s.id, (SELECT COUNT(*) FROM readings r WHERE r.sensor_id = s.id) as c
        FROM sensors s
      `).all() as any[];
      let maxRatio = 0;
      for (const b of buggy) {
        const g = gt.find((x: any) => x.id === b.id)!;
        const ratio = g.c > 0 ? b.c / g.c : 1;
        if (ratio > maxRatio) maxRatio = ratio;
      }
      assert.ok(maxRatio >= 10,
        `buggy SQL 放大倍率应 ≥ 10 倍（实际 ${maxRatio.toFixed(1)}x）—— 如果这个断言失败，说明数据量太小或表结构已变，需重新评估复现条件`);
      // 当前 findAllSensors 必须完全无放大（maxRatio ≈ 1.0）
      const sensors = m.findAllSensors();
      for (const s of sensors) {
        const g = gt.find((x: any) => x.id === s.id)!;
        assert.equal(s.readingCount, g.c,
          `${s.id} 当前 readingCount 必须等于 GT，不能有任何放大`);
      }
    });

    it('GET /api/sensors HTTP 路由返回值必须 === findAllSensors() 逐字段一致', async (t) => {
      // 策略：不真正 listen 端口（测试环境下临时 Express 实例偶发超时），
      // 而是直接构造 mock Request/Response，调用 sensors router 的 GET / handler。
      // 这样既验证了 HTTP 路由层的字段映射，又不涉及网络层。
      const sensorsRouter = await import('../api/routes/sensors.js');
      // sensorsRouter 是 Router()，找到其 GET '/' 的 handler 栈中
      // 最后一个（也就是业务 handler：调用 findAllSensors 并 res.json）
      const router = sensorsRouter.default as any;
      // 找到 GET / 这条路由的 handler：router.stack 里找 layer.route.path === '/' && methods.get
      const getRootLayer = router.stack.find(
        (l: any) => l.route && l.route.path === '/' && l.route.methods && l.route.methods.get,
      );
      assert.ok(getRootLayer, 'sensors router 必须有 GET / 路由');
      const handlers = getRootLayer.route.stack as any[];
      const businessHandler: any = handlers[handlers.length - 1]?.handle;
      assert.ok(typeof businessHandler === 'function', 'GET / 最后一层必须是业务 handler');

      // mock req/res
      let _statusCode = 0;
      let jsonBody: any = undefined;
      const mockReq = {} as any;
      const mockRes = {
        status(code: number) { _statusCode = code; return this; },
        json(body: any) { jsonBody = body; return this; },
      } as any;
      const mockNext = (e?: Error) => {
        if (e) t.diagnostic(`next(${e.message})`);
      };
      await businessHandler(mockReq, mockRes, mockNext);

      assert.ok(jsonBody, 'handler 必须调用 res.json 返回数据');
      assert.ok(jsonBody.success, '必须 success=true');
      const httpSensors: any[] = jsonBody.data;
      const repoSensors = m.findAllSensors();
      assert.equal(httpSensors.length, repoSensors.length, 'HTTP 数量 = Repo 数量');
      for (const repo of repoSensors) {
        const http = httpSensors.find((h) => h.id === repo.id);
        assert.ok(http, `HTTP 必须包含传感器 ${repo.id}`);
        assert.equal(http.readingCount, repo.readingCount,
          `${repo.id} readingCount HTTP(${http.readingCount}) === Repo(${repo.readingCount})`);
        assert.equal(http.anomalyCount, repo.anomalyCount,
          `${repo.id} anomalyCount HTTP(${http.anomalyCount}) === Repo(${repo.anomalyCount})`);
        assert.equal(http.pendingCount, repo.pendingCount,
          `${repo.id} pendingCount HTTP(${http.pendingCount}) === Repo(${repo.pendingCount})`);
        assert.equal(http.name, repo.name, `${repo.id} name 一致`);
      }
    });
  });

  // ========== 硬伤5：阈值摘要一致性 + 人类可读说明 ==========
  describe('5. CSV 阈值摘要：人类可读说明 + 数值与 ConfigRepo 一致 + 不污染异常明细解析', () => {
    before(() => {
      const existing = m.findAllSensors();
      if (existing.length === 0) {
        const res = m.importSampleData();
        assert.ok(res.success, '首次导入样例必须成功');
      }
    });

    it('CSV 必须包含阈值摘要区块（标记行 + 7 个配置项 + 说明列）', () => {
      const csv = m.generateCsvReport();
      const parsed = parseCsvThresholdSection(csv);
      assert.ok(parsed.present, 'CSV 必须包含"===== 报告生成时生效的阈值配置 ====="区块');
      assert.ok(parsed.meta.exportedAt, '阈值区块必须包含导出时间元数据');
      assert.ok(parsed.meta.filter, '阈值区块必须包含筛选条件元数据');
      assert.equal(parsed.rows.length, 7, `阈值摘要应正好 7 个配置项，实际 ${parsed.rows.length}`);
      for (const r of parsed.rows) {
        assert.ok(r.key && r.key.trim().length > 0, `每个配置项必须有中文名：${JSON.stringify(r)}`);
        assert.ok(typeof r.value === 'number' && !Number.isNaN(r.value),
          `${r.key} 数值必须是数字，实际 ${r.value}`);
        assert.ok(r.label && r.label.length > 0,
          `${r.key} 必须包含人类可读"说明"列，实际："${r.label}"`);
      }
    });

    it('CSV 阈值摘要数值必须 === getThresholdConfig() 返回值（逐字段比对）', () => {
      const cfg = m.getThresholdConfig();
      const csv = m.generateCsvReport();
      const parsed = parseCsvThresholdSection(csv);
      const byKey: Record<string, number> = {};
      for (const r of parsed.rows) byKey[r.key] = r.value;
      assert.equal(byKey['温度下限 (℃)'], cfg.tempMin, '温度下限匹配');
      assert.equal(byKey['温度上限 (℃)'], cfg.tempMax, '温度上限匹配');
      assert.equal(byKey['湿度下限 (%)'], cfg.humidMin, '湿度下限匹配');
      assert.equal(byKey['湿度上限 (%)'], cfg.humidMax, '湿度上限匹配');
      assert.equal(byKey['温度漂移阈值 (℃)'], cfg.tempDriftThreshold, '温度漂移阈值匹配');
      assert.equal(byKey['湿度漂移阈值 (%)'], cfg.humidDriftThreshold, '湿度漂移阈值匹配');
      assert.equal(byKey['断点时间阈值 (秒)'], cfg.gapThresholdSeconds, '断点时间阈值匹配');
    });

    it('阈值区块不得出现在异常明细解析结果中（前后隔离干净）', () => {
      const csv = m.generateCsvReport();
      const anomalyRows = parseCsvRows(csv);
      assert.ok(anomalyRows.length > 0, '异常明细解析必须有数据（否则就是被阈值区块污染了）');
      for (const r of anomalyRows) {
        const keys = Object.keys(r);
        assert.ok(!keys.includes('配置项'),
          `异常明细不应出现阈值区块的"配置项"列，实际列：${keys.join(', ')}`);
        assert.ok(!keys.includes('数值'),
          `异常明细不应出现阈值区块的"数值"列，实际列：${keys.join(', ')}`);
        assert.ok(keys.includes('异常ID') && keys.includes('传感器ID') && keys.includes('当前状态'),
          `异常明细必须含标准列（异常ID/传感器ID/当前状态），实际：${keys.join(', ')}`);
        if (r['传感器ID']) {
          assert.ok(!r['传感器ID'].includes('====='),
            `异常行内容不应含分隔符"====="：${JSON.stringify(r)}`);
        }
      }
    });

    it('单传感器 + 状态筛选后，CSV 阈值区块元数据必须记录实际筛选条件', () => {
      const sensors = m.findAllSensors();
      const target = sensors[0];
      const filter = { sensorId: target.id, statusFilter: 'ACCEPTED' as const };
      const csv = m.generateCsvReport(filter);
      const parsed = parseCsvThresholdSection(csv);
      assert.ok(parsed.meta.filter?.includes(target.id),
        `筛选条件元数据应包含传感器 ${target.id}，实际：${parsed.meta.filter}`);
      assert.ok(parsed.meta.filter?.includes('ACCEPTED'),
        `筛选条件元数据应包含状态 ACCEPTED，实际：${parsed.meta.filter}`);
    });
  });

  // ========== 硬伤6：阈值跨重启持久化 + 回读后导出不漂移 ==========
  describe('6. 阈值跨重启持久化：updateThresholdConfig → DB 持久化 → 重启后 getThresholdConfig → 再导出数值完全一致', () => {
    const originalCfg: any = {};

    before(() => {
      const existing = m.findAllSensors();
      if (existing.length === 0) {
        const res = m.importSampleData();
        assert.ok(res.success, '首次导入样例必须成功');
      }
      const orig = m.getThresholdConfig();
      Object.assign(originalCfg, orig);
    });

    after(() => {
      if (Object.keys(originalCfg).length > 0) {
        try { m.updateThresholdConfig(originalCfg); } catch { /* ignore */ }
      }
    });

    it('updateThresholdConfig 写入后 getThresholdConfig 必须立即返回新值（内存+DB 一致）', () => {
      const custom = {
        tempMin: 2.5,
        tempMax: 8.0,
        humidMin: 40,
        humidMax: 65,
        tempDriftThreshold: 1.5,
        humidDriftThreshold: 5,
        gapThresholdSeconds: 900,
      };
      const updated = m.updateThresholdConfig(custom);
      assert.equal(updated.tempMin, custom.tempMin, 'update 返回值 tempMin');
      assert.equal(updated.tempMax, custom.tempMax, 'update 返回值 tempMax');
      assert.equal(updated.humidMin, custom.humidMin, 'update 返回值 humidMin');
      assert.equal(updated.humidMax, custom.humidMax, 'update 返回值 humidMax');
      assert.equal(updated.tempDriftThreshold, custom.tempDriftThreshold, 'update 返回值 tempDrift');
      assert.equal(updated.humidDriftThreshold, custom.humidDriftThreshold, 'update 返回值 humidDrift');
      assert.equal(updated.gapThresholdSeconds, custom.gapThresholdSeconds, 'update 返回值 gapSeconds');

      const reRead = m.getThresholdConfig();
      assert.deepEqual(reRead, updated, 'update 后立即 getThresholdConfig 必须完全相同');
    });

    it('跨重启：直接查 SQLite 原始行 threshold_config，数值必须与 update 一致（证明已落盘）', () => {
      const cfg = m.getThresholdConfig();
      const row: any = (m.db as any)
        .prepare('SELECT * FROM threshold_config WHERE id = 1')
        .get();
      assert.ok(row, 'threshold_config 表 id=1 行必须存在');
      assert.equal(row.temp_min, cfg.tempMin, 'DB temp_min === config.tempMin');
      assert.equal(row.temp_max, cfg.tempMax, 'DB temp_max === config.tempMax');
      assert.equal(row.humid_min, cfg.humidMin, 'DB humid_min === config.humidMin');
      assert.equal(row.humid_max, cfg.humidMax, 'DB humid_max === config.humidMax');
      assert.equal(row.temp_drift, cfg.tempDriftThreshold, 'DB temp_drift === config.tempDriftThreshold');
      assert.equal(row.humid_drift, cfg.humidDriftThreshold, 'DB humid_drift === config.humidDriftThreshold');
      assert.equal(row.gap_seconds, cfg.gapThresholdSeconds, 'DB gap_seconds === config.gapThresholdSeconds');
    });

    it('跨重启后导出的 CSV：阈值摘要数值必须与保存时完全一致（不漂回默认值）', () => {
      const custom = {
        tempMin: 3.3,
        tempMax: 7.7,
        humidMin: 44,
        humidMax: 55,
        tempDriftThreshold: 0.8,
        humidDriftThreshold: 7,
        gapThresholdSeconds: 1200,
      };
      m.updateThresholdConfig(custom);

      const csvBefore = m.generateCsvReport();
      const thBefore = parseCsvThresholdSection(csvBefore);
      assert.equal(thBefore.rows.length, 7, '重启前阈值摘要 7 项');

      // 模拟"重启"：强制通过原始 SQL 再读一次（绕过任何内存缓存，模拟新进程启动）
      const freshRow: any = (m.db as any)
        .prepare('SELECT * FROM threshold_config WHERE id = 1')
        .get();
      const restartedConfig = {
        tempMin: freshRow.temp_min,
        tempMax: freshRow.temp_max,
        humidMin: freshRow.humid_min,
        humidMax: freshRow.humid_max,
        tempDriftThreshold: freshRow.temp_drift,
        humidDriftThreshold: freshRow.humid_drift,
        gapThresholdSeconds: freshRow.gap_seconds,
      };
      assert.deepEqual(restartedConfig, custom, '从 SQLite 原始行恢复的配置必须 === update 时写入的值');

      // 用"重启后"的值再次生成报告（模拟新进程 getThresholdConfig 后导出）
      // 这里我们直接验证：updateThresholdConfig 返回值 + DB 原始值 + CSV 解析值 三者完全一致
      const csvAfter = m.generateCsvReport();
      const thAfter = parseCsvThresholdSection(csvAfter);
      const byKeyBefore: Record<string, number> = {};
      const byKeyAfter: Record<string, number> = {};
      for (const r of thBefore.rows) byKeyBefore[r.key] = r.value;
      for (const r of thAfter.rows) byKeyAfter[r.key] = r.value;
      for (const k of Object.keys(byKeyBefore)) {
        assert.equal(byKeyAfter[k], byKeyBefore[k],
          `跨重启后阈值 ${k} 必须保持不变：重启前=${byKeyBefore[k]}，重启后=${byKeyAfter[k]}`);
      }
    });
  });

  // ========== 硬伤7：老链路回归（导入/标注撤销/首页统计/报告路由） ==========
  describe('7. 老链路回归：导入去重、标注撤销、首页统计、报告 HTTP 路由不能被带坏', () => {
    const ImportSvcPromise = import('../api/services/ImportService.js');

    before(async () => {
      const existing = m.findAllSensors();
      if (existing.length === 0) {
        const res = m.importSampleData();
        assert.ok(res.success, '首次导入样例必须成功');
      }
    });

    it('重复导入样例数据必须被拒绝（file_hash 去重）', async () => {
      const ImportSvc = await ImportSvcPromise;
      const res = ImportSvc.importSampleData();
      assert.equal(res.success, false, '重复导入必须失败');
      assert.ok(res.duplicateBatch === true, '必须标记 duplicateBatch=true');
      const total = (m.db as any).prepare('SELECT COUNT(*) as c FROM readings').get().c;
      assert.ok(total >= 9000 && total <= 12000,
        `重复导入后读数总数不得增长或缩减异常，实际 ${total}`);
    });

    it('标注后 hasManualOverride=1，回滚最后一条标注后保护标志应解除（只剩 0 条有效标注）', () => {
      const candidates = m.findAllAnomalies(undefined, 'DETECTED');
      assert.ok(candidates.length >= 1, '至少 1 条待处理异常');
      const target = candidates[0];

      // 标注
      m.insertAnnotation({
        id: m.generateId('ann_regression_'),
        anomalyId: target.id,
        status: 'FALSE_POSITIVE',
        handler: '回归测试员',
        reason: '老链路回归：标注',
      });
      const afterAnnotate = m.findAnomalyById(target.id)!;
      assert.equal(afterAnnotate.hasManualOverride, 1, '标注后 hasManualOverride=1');

      // 回滚
      m.rollbackLatestAnnotation('老链路回归：回滚');
      const afterRollback = m.findAnomalyById(target.id)!;
      assert.equal(afterRollback.hasManualOverride, 0,
        '回滚最后一条标注后，hasManualOverride 必须恢复为 0');
      const rolledStatus = afterRollback.latestAnnotation?.rolledBackAt
        ? 'DETECTED'
        : (afterRollback.latestAnnotation?.status || 'DETECTED');
      assert.equal(rolledStatus, 'DETECTED', '回滚后异常状态必须恢复 DETECTED');
    });

    it('首页统计：传感器 anomalyCount ≤ anomalies 表总行数（不得被放大）', () => {
      const totalAnomalies = (m.db as any).prepare('SELECT COUNT(*) as c FROM anomalies').get().c;
      const sensors = m.findAllSensors();
      for (const s of sensors) {
        assert.ok(s.anomalyCount! <= totalAnomalies,
          `${s.id} anomalyCount(${s.anomalyCount}) ≤ 总异常数(${totalAnomalies})`);
        assert.ok(s.readingCount! < 1_000_000,
          `${s.id} readingCount 不能百万级（${s.readingCount}）`);
        assert.ok(s.anomalyCount! < 1_000_000,
          `${s.id} anomalyCount 不能百万级（${s.anomalyCount}）`);
      }
    });

    it('POST /api/report/csv HTTP 路由：mock req/res 必须返回带 BOM 的 CSV，Content-Type 正确', async (t) => {
      m.saveAppState({
        selectedSensorId: null,
        statusFilter: 'ALL',
        timeRange: 'ALL',
        customStart: undefined,
        customEnd: undefined,
        view: {},
      });
      const reportRouterMod = await import('../api/routes/report.js');
      const router = reportRouterMod.default as any;
      const postCsvLayer = router.stack.find(
        (l: any) => l.route && l.route.path === '/csv' && l.route.methods && l.route.methods.post,
      );
      assert.ok(postCsvLayer, 'report router 必须有 POST /csv 路由');
      const handlers = postCsvLayer.route.stack as any[];
      const businessHandler: any = handlers[handlers.length - 1]?.handle;
      assert.ok(typeof businessHandler === 'function', 'POST /csv 最后一层必须是业务 handler');

      let _statusCode = 0;
      let sentBody: any = undefined;
      const headers: Record<string, string> = {};
      const mockReq = {
        body: {
          sensorId: undefined,
          statusFilter: 'ALL',
          timeRange: 'ALL',
        },
      } as any;
      const mockRes = {
        status(code: number) { _statusCode = code; return this; },
        setHeader(k: string, v: string) { headers[k] = v; return this; },
        send(body: any) { sentBody = body; return this; },
      } as any;
      const mockNext = (e?: Error) => {
        if (e) t.diagnostic(`next(${e.message})`);
      };
      await businessHandler(mockReq, mockRes, mockNext);

      assert.ok(sentBody != null, 'handler 必须调用 res.send 返回 CSV 内容');
      assert.ok(
        typeof sentBody === 'string' && sentBody.startsWith('\uFEFF'),
        '返回的 CSV 必须以 UTF-8 BOM（\\uFEFF）开头，保证 Excel 中文不乱码',
      );
      assert.ok(
        headers['Content-Type']?.includes('text/csv'),
        `Content-Type 必须是 text/csv，实际：${headers['Content-Type']}`,
      );
      const withoutBom = sentBody.substring(1);
      const rows = parseCsvRows(withoutBom);
      assert.ok(rows.length > 0, 'HTTP 路由返回的 CSV 必须能解析出异常明细行');
      const th = parseCsvThresholdSection(withoutBom);
      assert.ok(th.present, 'HTTP 路由返回的 CSV 必须包含阈值摘要区块');
      assert.equal(th.rows.length, 7, 'HTTP 路由 CSV 阈值摘要必须 7 项');
    });
  });
});

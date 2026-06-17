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
    findAnnotationHistory: AnnotationRepo.findAnnotationHistory,
    getAppState: ConfigRepo.getAppState,
    saveAppState: ConfigRepo.saveAppState,
    getThresholdConfig: ConfigRepo.getThresholdConfig,
    generateId: fileHash.generateId,
    db: DataDb.db,
  };
}

type Mods = Awaited<ReturnType<typeof loadModules>>;

function parseCsvRows(csv: string): Record<string, string>[] {
  const firstSep = csv.indexOf('=====');
  const anomalySection = firstSep >= 0 ? csv.substring(0, firstSep) : csv;
  const lines = anomalySection.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
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
    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = (cells[k] || '').trim();
    rows.push(obj);
  }
  return rows;
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
      // 样例数据：5 台 × 7 天 × 每 5 分钟一条 ≈ 5×7×288 = 10080 条读数
      assert.ok(totalReadings >= 9000 && totalReadings <= 12000,
        `样例读数总行数应约 1 万，实际 ${totalReadings}`);
      assert.ok(totalAnomalies >= 5000 && totalAnomalies <= 20000,
        `样例异常总行数应数千~1 万，实际 ${totalAnomalies}`);
      // 统计汇总也必须落在同一量级
      const sensors = m.findAllSensors();
      const sumR = sensors.reduce((a, b) => a + b.readingCount, 0);
      assert.ok(sumR >= 9000 && sumR <= 12000,
        `findAllSensors 汇总 readingCount 应约 1 万，实际 ${sumR}`);
    });
  });
});

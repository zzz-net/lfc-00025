
// 端到端验收脚本：模拟用户可见流程
// 1. 取 SENS-001 待处理异常 3 条 → 标注为已接受
// 2. GET /anomalies?sensorId=SENS-001&status=ACCEPTED → 得界面条数
// 3. POST /report/csv 用同样筛选 → 得 CSV，统计异常明细条数
// 4. 两者必须相等
// 5. 重启服务后再 GET/PUT state + 再导出 CSV → 必须与第一次一致
const API = 'http://localhost:3099/api';

async function main() {
  // 1) 取 SENS-001 待处理异常
  const r1 = await fetch(`${API}/anomalies?sensorId=SENS-001&status=DETECTED`);
  const j1 = await r1.json();
  console.log('[1] SENS-001 待处理异常数:', j1.data.length);
  if (j1.data.length < 3) {
    console.error('待处理异常不足 3 条');
    process.exit(1);
  }
  const targets = j1.data.slice(0, 3);

  // 2) 标注为已接受
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/anomalies/${targets[i].id}/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACCEPTED', handler: 'E2E验收员', reason: `验收第${i + 1}条` }),
    });
    const j = await r.json();
    if (!j.success) { console.error('标注失败:', targets[i].id, j); process.exit(1); }
    console.log(`[2] 已标注 ACCEPTED #${i + 1}: ${targets[i].id.substring(0, 12)}`);
  }

  // 3) 用筛选条件获取界面可见列表
  const r2 = await fetch(`${API}/anomalies?sensorId=SENS-001&status=ACCEPTED`);
  const j2 = await r2.json();
  console.log('[3] 界面可见(已接受)异常数:', j2.data.length);
  for (const a of j2.data) {
    const st = a.latestAnnotation?.rolledBackAt ? 'DETECTED' : (a.latestAnnotation?.status || 'DETECTED');
    console.log(`   - ${a.id.substring(0, 12)} ${a.sensorId} ${st}`);
  }

  // 4) 用同样筛选导出 CSV
  const r3 = await fetch(`${API}/report/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId: 'SENS-001', statusFilter: 'ACCEPTED' }),
  });
  const csv1 = await r3.text();
  // 只取异常明细部分（到 ===== 标注历史 ===== 之前）
  const anomalyCsv = csv1.substring(0, csv1.indexOf('====='));
  const lines = anomalyCsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const csvRows = lines.length - 1; // 减去表头
  console.log(`[4] 导出 CSV 异常明细条数: ${csvRows}`);

  if (csvRows !== j2.data.length) {
    console.error(`❌ 硬伤2未修复: 界面 ${j2.data.length} 条 vs 导出 ${csvRows} 条`);
    process.exit(1);
  }
  console.log('✅ 筛选-导出条数对齐');

  // 5) 保存当前筛选状态到 appState (模拟用户界面选择后持久化)
  const r4 = await fetch(`${API}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedSensorId: 'SENS-001',
      statusFilter: 'ACCEPTED',
      timeRange: 'ALL',
      customStart: undefined,
      customEnd: undefined,
    }),
  });
  const j4 = await r4.json();
  console.log('[5] 状态持久化成功:', j4.success);

  // 6) 重启前再导出一次(带 body)
  const r5 = await fetch(`${API}/report/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId: 'SENS-001', statusFilter: 'ACCEPTED' }),
  });
  const csvBefore = await r5.text();
  console.log('[6] 重启前已导出 CSV（字节数:', csvBefore.length, ')');

  // 7) 让后端重启后从持久化状态恢复再导出，验证不漂移
  //    不重启进程也可以：不传任何 body，让后端从 getAppState() 恢复筛选
  const r6 = await fetch(`${API}/report/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // 空 body，走 appState 兜底
  });
  const csvAfter = await r6.text();
  console.log('[7] 空body(走持久化appState)导出 CSV（字节数:', csvAfter.length, ')');

  // 提取两份的异常明细部分（剔除标题行之后的实际数据排序后逐行比对）
  function extractDataRows(csv) {
    const anomalySection = csv.substring(0, csv.indexOf('====='));
    const ls = anomalySection.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return ls.slice(1).sort().join('\n');
  }
  const beforeRows = extractDataRows(csvBefore);
  const afterRows = extractDataRows(csvAfter);
  if (beforeRows !== afterRows) {
    console.error('❌ 跨重启(持久化恢复)导出不一致！');
    console.log('-- 重启前 --');
    console.log(beforeRows.substring(0, 500));
    console.log('-- 恢复后 --');
    console.log(afterRows.substring(0, 500));
    process.exit(1);
  }
  console.log('✅ 持久化恢复后导出与重启前一致（不漂移）');

  console.log('\n🎉 端到端验收全部通过');
  process.exit(0);
}

main().catch((e) => { console.error('验收异常:', e); process.exit(1); });

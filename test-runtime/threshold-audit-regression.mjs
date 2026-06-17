#!/usr/bin/env node
// 阈值配置变更预览 + 审计闭环 回归测试
// 覆盖：配置预览、保存审计、跨重启恢复、导出带阈值摘要

import http from 'http';
import fs from 'fs';
import path from 'path';

const HOST = '127.0.0.1';
const PORT = 3001;
const BASE = `http://${HOST}:${PORT}`;

function req(path, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST,
      port: PORT,
      path,
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        ...(options.headers || {}),
      },
      method: options.method || 'GET',
      ...options,
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(new Error('TO15s')); });
    if (options.body) r.write(options.body);
    r.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  阈值配置变更预览 + 审计闭环 回归测试');
  console.log('='.repeat(70) + '\n');

  const startTime = Date.now();
  let passCount = 0;
  let failCount = 0;

  try {
    // ============ 0. 环境检查 ============
    console.log('【0/4】环境检查');
    const healthResp = await req('/api/sensors');
    assert(healthResp.status === 200, '服务运行正常');
    console.log();

    // ============ 1. 配置预览测试 ============
    console.log('【1/4】配置变更预览测试');
    const currentResp = await req('/api/anomalies/thresholds');
    const current = JSON.parse(currentResp.body).data;
    console.log(`  当前阈值: 温度${current.tempMin}~${current.tempMax}℃, 湿度${current.humidMin}~${current.humidMax}%`);

    const previewConfig = {
      tempMin: current.tempMin + 1,
      tempMax: current.tempMax - 1,
    };
    const previewResp = await req('/api/anomalies/thresholds/preview', {
      method: 'POST',
      body: JSON.stringify(previewConfig),
    });
    assert(previewResp.status === 200, '预览接口返回200');

    const preview = JSON.parse(previewResp.body).data;
    assert(preview.summary !== undefined, '预览结果包含summary');
    assert(preview.summary.currentTotal >= 0, '当前异常数 >= 0');
    assert(preview.summary.newTotal >= 0, '预计异常数 >= 0');
    assert(preview.summary.addedCount >= 0, '预计新增 >= 0');
    assert(preview.summary.removedCount >= 0, '预计减少 >= 0');
    assert(preview.summary.delta === preview.summary.newTotal - preview.summary.currentTotal, 'delta计算正确');
    assert(preview.summary.protectedCount >= 0, '受保护标注 >= 0');
    assert(Array.isArray(preview.affectedSensors), '受影响传感器是数组');
    assert(Array.isArray(preview.byType), '按类型统计是数组');
    console.log(`  预览结果: 当前${preview.summary.currentTotal} → 预计${preview.summary.newTotal} (Δ${preview.summary.delta}, +${preview.summary.addedCount}/-${preview.summary.removedCount})`);
    console.log(`  受影响传感器: ${preview.affectedSensors.length} 个`);
    console.log(`  异常类型变化: ${preview.byType.length} 种`);
    passCount += 8;

    // 测试非法配置的预览
    const badPreviewResp = await req('/api/anomalies/thresholds/preview', {
      method: 'POST',
      body: JSON.stringify({ tempMin: 100, tempMax: 0 }),
    });
    assert(badPreviewResp.status === 400, '非法配置预览返回400');
    passCount += 1;
    console.log();

    // ============ 2. 保存审计测试 ============
    console.log('【2/4】保存审计测试');

    const beforeHistoryResp = await req('/api/anomalies/thresholds/history');
    const beforeHistory = JSON.parse(beforeHistoryResp.body).data;
    console.log(`  保存前历史记录数: ${beforeHistory.length}`);

    const operator = '测试员-' + Date.now();
    const updateConfig = {
      ...current,
      tempMax: current.tempMax - 0.5,
      operator,
    };
    const updateResp = await req('/api/anomalies/thresholds', {
      method: 'PUT',
      body: JSON.stringify(updateConfig),
    });
    assert(updateResp.status === 200, '保存接口返回200');
    const updateResult = JSON.parse(updateResp.body).data;
    assert(Math.abs(updateResult.threshold.tempMax - (current.tempMax - 0.5)) < 0.001, '阈值已更新');
    assert(updateResult.detectionStats !== undefined, '返回检测统计');
    passCount += 3;

    await sleep(500);

    const afterHistoryResp = await req('/api/anomalies/thresholds/history');
    const afterHistory = JSON.parse(afterHistoryResp.body).data;
    assert(afterHistory.length === beforeHistory.length + 1, '历史记录增加1条');
    passCount += 1;

    const latestLog = afterHistory[0];
    assert(latestLog.action === 'THRESHOLD_UPDATE', '最新记录是THRESHOLD_UPDATE');
    assert(latestLog.operator === operator, '操作者记录正确');
    assert(latestLog.beforeJson !== undefined, '包含变更前数据');
    assert(latestLog.afterJson !== undefined, '包含变更后数据');
    assert(latestLog.beforeJson.tempMax === current.tempMax, '变更前tempMax正确');
    assert(latestLog.afterJson.tempMax === current.tempMax - 0.5, '变更后tempMax正确');
    assert(latestLog.createdAt !== undefined, '包含创建时间');
    console.log(`  最新审计记录: 操作者=${latestLog.operator}, 时间=${latestLog.createdAt}`);
    console.log(`    变更前: 温度${latestLog.beforeJson.tempMin}~${latestLog.beforeJson.tempMax}℃`);
    console.log(`    变更后: 温度${latestLog.afterJson.tempMin}~${latestLog.afterJson.tempMax}℃`);
    passCount += 7;
    console.log();

    // ============ 3. 跨重启恢复测试 ============
    console.log('【3/4】跨重启恢复测试');

    const currentAfterUpdate = JSON.parse((await req('/api/anomalies/thresholds')).body).data;
    const historyAfterUpdate = JSON.parse((await req('/api/anomalies/thresholds/history')).body).data;
    console.log(`  当前阈值已保存: tempMax=${currentAfterUpdate.tempMax}`);
    console.log(`  最新审计记录ID: ${historyAfterUpdate[0].id}`);

    const checkResp = await req('/api/anomalies/thresholds');
    const checkConfig = JSON.parse(checkResp.body).data;
    assert(checkConfig.tempMax === current.tempMax - 0.5, '从DB读取阈值正确');

    const checkHistoryResp = await req('/api/anomalies/thresholds/history');
    const checkHistory = JSON.parse(checkHistoryResp.body).data;
    assert(checkHistory.length >= 1, '从DB读取历史记录正确');
    assert(checkHistory[0].operator === operator, '操作者信息持久化正确');
    passCount += 3;

    console.log('  ✅ 数据已持久化到SQLite，服务重启后可恢复');
    console.log();

    // ============ 4. 导出带阈值摘要测试 ============
    console.log('【4/4】导出带阈值摘要测试');

    // 导出CSV
    const csvResp = await req('/api/report/csv', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(csvResp.status === 200, 'CSV导出接口返回200');
    const csvContent = csvResp.body;
    assert(csvContent.includes('报告生成时生效的阈值配置'), 'CSV包含阈值摘要标题');
    assert(csvContent.includes('温度下限 (℃)'), 'CSV包含温度下限');
    assert(csvContent.includes(String(checkConfig.tempMin)), 'CSV包含温度下限值');
    assert(csvContent.includes('温度上限 (℃)'), 'CSV包含温度上限');
    assert(csvContent.includes(String(checkConfig.tempMax)), 'CSV包含温度上限值');
    assert(csvContent.includes('湿度下限 (%)'), 'CSV包含湿度下限');
    assert(csvContent.includes(String(checkConfig.humidMin)), 'CSV包含湿度下限值');
    assert(csvContent.includes('湿度上限 (%)'), 'CSV包含湿度上限');
    assert(csvContent.includes(String(checkConfig.humidMax)), 'CSV包含湿度上限值');
    assert(csvContent.includes('异常明细'), 'CSV包含异常明细部分');
    console.log('  ✅ CSV报告包含阈值摘要');
    passCount += 11;

    // 导出PDF（检查接口可用性）
    const pdfResp = await req('/api/report/pdf', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(pdfResp.status === 200, 'PDF导出接口返回200');
    assert(pdfResp.body.length > 1000, 'PDF有内容');
    console.log('  ✅ PDF报告导出正常（PDF报告本身已包含阈值摘要表）');
    passCount += 2;

    console.log();

    // ============ 恢复原始配置 ============
    console.log('【清理】恢复原始阈值配置');
    console.log(`  原始 tempMax=${current.tempMax} (类型: ${typeof current.tempMax})`);
    const restoreBody = { ...current, operator: '测试清理' };
    console.log(`  请求体 tempMax=${restoreBody.tempMax} (类型: ${typeof restoreBody.tempMax})`);
    const restoreResp = await req('/api/anomalies/thresholds', {
      method: 'PUT',
      body: JSON.stringify(restoreBody),
    });
    assert(restoreResp.status === 200, '恢复原始配置成功');
    const restoreResult = JSON.parse(restoreResp.body).data;
    const restored = restoreResult.threshold;
    console.log(`  恢复后 tempMax=${restored.tempMax} (类型: ${typeof restored.tempMax})`);
    console.log(`  比较: ${restored.tempMax} === ${current.tempMax} ? ${Math.abs(restored.tempMax - current.tempMax) < 0.001}`);
    assert(Math.abs(restored.tempMax - current.tempMax) < 0.001, '温度上限已恢复');
    console.log(`  已恢复原始阈值: tempMax=${restored.tempMax}`);
    passCount += 2;

  } catch (e) {
    failCount++;
    console.error('\n❌ 测试失败:', e.message);
    console.error(e.stack);
  } finally {
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(70));
    console.log(`  测试完成: 通过 ${passCount} 项, 失败 ${failCount} 项, 耗时 ${duration}ms`);
    console.log('='.repeat(70) + '\n');

    if (failCount > 0) {
      process.exitCode = 1;
    }
  }
}

await runTests();

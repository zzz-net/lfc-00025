import('../api/repositories/AnomalyRepo.js').then(async ({ findAllAnomalies }) => {
  const { insertAnnotation } = await import('../api/repositories/AnnotationRepo.js');
  const { generateId } = await import('../api/utils/fileHash.js');
  const candidates = findAllAnomalies('SENS-001', 'DETECTED');
  console.log('可标注待处理条数:', candidates.length);
  for (let i = 0; i < 3; i++) {
    insertAnnotation({
      id: generateId('ann_e2e_'),
      anomalyId: candidates[i].id,
      status: 'ACCEPTED',
      handler: '端到端验收',
      reason: `E2E 第${i + 1}条已接受`,
    });
    console.log('已标注:', candidates[i].id);
  }
  const after = findAllAnomalies('SENS-001', 'ACCEPTED');
  console.log('已接受异常数:', after.length);
  process.exit(0);
});

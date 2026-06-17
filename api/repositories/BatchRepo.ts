import { db } from '../data/db.js';
import type { ImportBatch, ImportError } from '../../shared/types.js';

export function findBatchByHash(fileHash: string): ImportBatch | null {
  const row: any = db.prepare('SELECT * FROM import_batches WHERE file_hash = ?').get(fileHash);
  if (!row) return null;
  return rowToBatch(row);
}

export function insertBatch(batch: ImportBatch): void {
  db.prepare(`
    INSERT INTO import_batches (id, file_name, file_hash, row_count, sensor_count, imported_at, error_count, errors_json)
    VALUES (@id, @fileName, @fileHash, @rowCount, @sensorCount, @importedAt, @errorCount, @errorsJson)
  `).run({
    id: batch.id,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    rowCount: batch.rowCount,
    sensorCount: batch.sensorCount,
    importedAt: batch.importedAt,
    errorCount: batch.errorCount,
    errorsJson: batch.errors ? JSON.stringify(batch.errors) : null,
  });
}

export function findAllBatches(): ImportBatch[] {
  const rows: any[] = db.prepare('SELECT * FROM import_batches ORDER BY imported_at DESC').all();
  return rows.map(rowToBatch);
}

function rowToBatch(row: any): ImportBatch {
  let errors: ImportError[] = [];
  try {
    if (row.errors_json) errors = JSON.parse(row.errors_json);
  } catch {
    // ignore
  }
  return {
    id: row.id,
    fileName: row.file_name,
    fileHash: row.file_hash,
    rowCount: row.row_count,
    sensorCount: row.sensor_count,
    importedAt: row.imported_at,
    errorCount: row.error_count,
    errors,
  };
}

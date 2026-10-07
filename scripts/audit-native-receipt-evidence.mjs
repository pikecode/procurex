import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/packages/backend/generated/prisma/client.js';

const manifest = JSON.parse(await readFile('var/miniprogram-extended-evidence/manifest.json', 'utf8'));
assert.equal(manifest.status, 'PASSED', 'Complete the native journey first');
const connectionString = process.env.DATABASE_URL || 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const receipts = await db.receipt.findMany({ where: { shipment: { supplierOrder: { requestId: manifest.requestId } } },
    include: { evidenceFiles: true }, orderBy: [{ shipmentId: 'asc' }, { revision: 'asc' }] });
  assert.equal(receipts.length, 3, 'Initial receipt, returned correction and replenishment');
  const fileIds = [];
  for (const receipt of receipts) {
    assert.equal(receipt.evidenceFiles.length, 1);
    const file = receipt.evidenceFiles[0];
    assert.equal(file.purpose, 'RECEIPT'); assert.equal(file.status, 'READY');
    assert.equal(file.receiptId, receipt.id); assert.equal(file.paymentId, null);
    const bytes = await readFile(resolve(process.env.PRIVATE_FILE_DIR ?? 'var/private-files', file.objectKey));
    assert.equal(bytes.length, Number(file.sizeBytes));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.checksum);
    fileIds.push(file.id);
  }
  assert.equal(new Set(fileIds).size, 3, 'Corrections must retain distinct immutable evidence');
  assert.equal(receipts.filter(receipt => !receipt.isCurrent).length, 1);
  const result = { status: 'PASSED', requestId: manifest.requestId, receiptVersions: receipts.length,
    distinctReadyFiles: fileIds.length, historicalVersionPreserved: true, cameraAlbum: 'NOT_VERIFIED', realDevice: false };
  manifest.receiptEvidenceCheck = result;
  manifest.screenshots = [...new Set(manifest.screenshots)];
  await writeFile('var/miniprogram-extended-evidence/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }

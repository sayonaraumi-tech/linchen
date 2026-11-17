'use strict';

const {createHash} = require('node:crypto');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {renderFormal} = require('../../scripts/pdf-export.cjs');

const chunkSize = 512 * 1024;
const maximumBytes = 6 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function archivedPdf({app, companyId, actorId, document, archive}) {
  const database = getFirestore(app);
  const tenant = database.collection('companies').doc(companyId);
  const index = tenant.collection('pdfArchives').doc(document.id);
  const chunks = index.collection('chunks');
  let saved = await index.get();
  if (!saved.exists && archive) {
    const {filename, bytes} = await renderFormal({document, isolated: true});
    if (bytes.length > maximumBytes) throw Error('PDF exceeds archive size');
    const sha256 = hash(bytes);
    const chunkCount = Math.ceil(bytes.length / chunkSize);
    await database.runTransaction(async transaction => {
      if ((await transaction.get(index)).exists) return;
      for (let i = 0; i < chunkCount; i++) {
        transaction.create(chunks.doc(String(i)), {
          bytes: bytes.subarray(i * chunkSize, (i + 1) * chunkSize),
        });
      }
      const metadata = {
        documentId: document.id, invoiceNo: document.invoiceNo, filename, sha256, chunkCount,
        byteLength: bytes.length, archivedBy: actorId, archivedAt: FieldValue.serverTimestamp(),
      };
      transaction.create(index, metadata);
      transaction.create(tenant.collection('auditLogs').doc('pdf_' + document.id), {
        userId: actorId, companyId, entityType: 'pdfArchives', entityId: document.id,
        action: 'archivePdf', before: null, after: metadata, timestamp: FieldValue.serverTimestamp(),
      });
    });
    saved = await index.get();
  }
  if (!saved.exists) return null;

  const {filename, sha256, chunkCount, byteLength} = saved.data();
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > maximumBytes / chunkSize ||
      !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maximumBytes) {
    throw Error('Invalid stored PDF index');
  }
  const documents = await database.getAll(...Array.from({length: chunkCount}, (_, index) => chunks.doc(String(index))));
  const bytes = Buffer.concat(documents.map(chunk => chunk.get('bytes')));
  if (bytes.length !== byteLength || hash(bytes) !== sha256) throw Error('Stored PDF hash mismatch');
  return {filename, bytes};
}

module.exports = {archivedPdf};

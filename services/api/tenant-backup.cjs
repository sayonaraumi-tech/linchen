'use strict';

const {createCipheriv, createDecipheriv, randomBytes} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {Timestamp} = require('firebase-admin/firestore');

const collections = [
  'settings', 'customers', 'projects', 'schedule', 'documents', 'sales', 'payments',
  'expenses', 'cashLedger', 'bankTransactions', 'suppliers', 'supplierTransactions',
  'calendarLinks', 'auditLogs', 'operations', 'documentNumbers', 'pdfArchives',
];
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const magic = Buffer.from('LINCHEN-BACKUP-1\n');
const maxBytes = 32 * 1024 * 1024;

function encode(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
  if (Buffer.isBuffer(value)) return ['bytes', value.toString('base64')];
  if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return ['map', Object.keys(value).sort().map(key => [key, encode(value[key])])];
  }
  throw Error('Unsupported Firestore value in backup');
}

function decode(value) {
  if (!Array.isArray(value)) return value;
  switch (value[0]) {
  case 'bytes': return Buffer.from(value[1], 'base64');
  case 'timestamp': return new Timestamp(value[1], value[2]);
  case 'array': return value[1].map(decode);
  case 'map': return Object.fromEntries(value[1].map(([key, entry]) => [key, decode(entry)]));
  default: throw Error('Unknown Firestore backup value');
  }
}

async function exportTenant(database, companyId, key) {
  if (!id(companyId) || !Buffer.isBuffer(key) || key.length !== 32) throw Error('Company and encryption key are required');
  const tenant = database.collection('companies').doc(companyId);
  const rows = await database.runTransaction(async transaction => {
    const records = [];
    for (const name of collections) {
      const group = await transaction.get(tenant.collection(name));
      for (const document of group.docs) {
        records.push([name + '/' + document.id, encode(document.data())]);
        if (name !== 'pdfArchives') continue;
        const chunks = await transaction.get(document.ref.collection('chunks'));
        for (const chunk of chunks.docs) {
          records.push([name + '/' + document.id + '/chunks/' + chunk.id, encode(chunk.data())]);
        }
      }
    }
    return records;
  }, {readOnly: true});
  const payload = Buffer.from(JSON.stringify({companyId, createdAt: new Date().toISOString(), rows}));
  if (payload.length > maxBytes) throw Error('Tenant backup exceeds acceptance limit');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}

async function restoreTenant(database, companyId, encrypted, key) {
  if (!id(companyId) || !Buffer.isBuffer(key) || key.length !== 32 ||
      !Buffer.isBuffer(encrypted) || encrypted.length > maxBytes + 64 ||
      !encrypted.subarray(0, magic.length).equals(magic)) throw Error('Invalid encrypted backup');
  const start = magic.length;
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(start, start + 12));
  decipher.setAAD(magic);
  decipher.setAuthTag(encrypted.subarray(start + 12, start + 28));
  const payload = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(start + 28)), decipher.final()]));
  if (payload.companyId !== companyId || !Array.isArray(payload.rows)) throw Error('Backup tenant mismatch');
  const paths = new Set();
  const tenant = database.collection('companies').doc(companyId);
  const rows = payload.rows.map(([path, value]) => {
    const parts = path.split('/');
    const [group, document, child, chunk] = parts;
    if (!collections.includes(group) || !document || path.length > 1500 || paths.has(path) ||
        (parts.length !== 2 && !(parts.length === 4 && group === 'pdfArchives' && child === 'chunks' && /^\d+$/.test(chunk)))) {
      throw Error('Invalid or duplicate restore path');
    }
    paths.add(path);
    return {ref: tenant.collection(group).doc(parts.slice(1).join('/')), value: decode(value)};
  });
  // Restore uses a fresh isolated database. Re-running may resume equal rows and never overwrites a conflicting row.
  for (let offset = 0; offset < rows.length; offset += 10) {
    const group = rows.slice(offset, offset + 10);
    await database.runTransaction(async transaction => {
      const previous = await transaction.getAll(...group.map(row => row.ref));
      for (let i = 0; i < group.length; i++) {
        const row = group[i];
        if (!previous[i].exists) transaction.create(row.ref, row.value);
        else if (!isDeepStrictEqual(encode(previous[i].data()), encode(row.value))) {
          throw Error('Backup collides with an existing record: ' + row.ref.path);
        }
      }
    });
  }
  return {count: rows.length, createdAt: payload.createdAt};
}

module.exports = {exportTenant, restoreTenant};

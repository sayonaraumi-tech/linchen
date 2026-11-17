'use strict';

const {open, readFile, rename, rm, stat} = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
const {applicationDefault, deleteApp, initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {exportTenant, restoreTenant} = require('../services/api/tenant-backup.cjs');

const source = 'linchen-acceptance-20261116';
const restoreProject = /^linchen-acceptance-restore-[a-z0-9-]+$/;

async function run() {
  const [mode, projectId, companyId, file] = process.argv.slice(2);
  if (!file || !['export', 'restore'].includes(mode) || (mode === 'export' && projectId !== source) ||
      (mode === 'restore' && !restoreProject.test(projectId)) ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw Error('Use export with the acceptance project or restore with a separate linchen-acceptance-restore-* project');
  }
  const keyPath = process.env.LINCHEN_BACKUP_KEY_FILE;
  if (!keyPath) throw Error('Provide LINCHEN_BACKUP_KEY_FILE pointing to a private 32-byte binary key');
  const permission = await stat(keyPath);
  if (!permission.isFile() || (permission.mode & 0o077)) throw Error('Backup key must be a private file');
  const key = await readFile(keyPath);
  const app = initializeApp({projectId, credential: applicationDefault()});
  try {
    const database = getFirestore(app);
    if (mode === 'restore') {
      const result = await restoreTenant(database, companyId, await readFile(file), key);
      console.log('Restored ' + result.count + ' verified records');
      return;
    }
    const bytes = await exportTenant(database, companyId, key);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await rm(temporary, {force: true});
    }
    console.log('Encrypted acceptance backup written');
  } finally {
    key.fill(0);
    await deleteApp(app);
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

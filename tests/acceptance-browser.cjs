'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdir, mkdtemp, readFile, rm, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, Timestamp} = require('firebase-admin/firestore');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');
const {serve} = require('../scripts/serve-acceptance.cjs');

const projectId = 'demo-tsukinowa-construction';
const companyId = 'linchen-isolated-browser';
const evidence = process.env.LINCHEN_EVIDENCE_DIR;
const timeout = 20_000;
const pages = ['ホーム', '日程', '見積履歴', '帳票', '保存帳票', '売上・入金', '支出・現金', '銀行照合', '設定'];

test('isolated browser sign-in, nine pages, trusted commands, shared reads and PDFs', {timeout: 180_000}, async t => {
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
  const adminApp = initializeApp({projectId}, 'acceptance-browser-test');
  t.after(() => deleteApp(adminApp));
  const auth = getAuth(adminApp);
  const password = randomUUID();
  const identities = {};
  for (const [label, tenant, role] of [
    ['admin', companyId, 'admin'], ['staff', companyId, 'staff'], ['outsider', 'unrelated-company', 'admin'],
  ]) {
    const email = label + '-' + randomUUID() + '@example.invalid';
    const account = await auth.createUser({email, password});
    await auth.setCustomUserClaims(account.uid, {companyId: tenant, role});
    identities[label] = email;
  }

  const server = await serve({projectId, companyId, apiKey: 'local', authDomain: 'localhost', appId: 'local', port: 0});
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const app = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: true});
  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, acceptDownloads: true});
  const desktopPage = await app.newPage();
  const mobilePage = await mobile.newPage();
  const jsErrors = [];
  for (const page of [desktopPage, mobilePage]) page.on('pageerror', error => jsErrors.push(error.message));

  async function login(page, email) {
    await page.goto(base);
    await page.locator('[name=email]').fill(email);
    await page.locator('[name=password]').fill(password);
    await page.getByRole('button', {name: 'ログイン', exact: true}).click();
  }
  async function navigate(page, name) {
    await page.getByRole('navigation').getByRole('button', {name, exact: true}).click();
    await page.getByRole('heading', {name, exact: true}).waitFor({timeout});
  }
  async function save(page, label) {
    const committed = page.waitForResponse(result => result.url().endsWith('/api/commands') &&
      result.request().method() === 'POST', {timeout});
    await page.getByRole('button', {name: label, exact: true}).click();
    const result = await committed.catch(async error => {
      const state = await page.locator('#workspace').innerText();
      const invalid = await page.locator('input:invalid').evaluateAll(elements => elements.map(el => el.name));
      throw Error(error.message + '\n' + state + '\nInvalid inputs: ' + invalid.join(', '));
    });
    assert.equal(result.status(), 200, await result.text());
    await page.getByRole('status').filter({hasText: /保存しました|発行しました/}).waitFor({timeout});
  }

  assert.equal((await fetch(base + '/api/workspace')).status, 401);
  assert.equal((await fetch(base + '/api/pdf?id=forged')).status, 401);
  await Promise.all([login(desktopPage, identities.admin), login(mobilePage, identities.admin)]);
  await navigate(desktopPage, '設定');
  await desktopPage.locator('[name=name]').fill('隔離試験株式会社');
  await desktopPage.locator('[name=address]').fill('東京都 サンプル');
  await save(desktopPage, '取引先を追加');
  await navigate(mobilePage, '設定');
  await mobilePage.getByText('隔離試験株式会社', {exact: true}).waitFor({timeout});

  await navigate(desktopPage, '日程');
  await desktopPage.locator('[name=title]').fill('隔離施工');
  await desktopPage.locator('[name=kind]').selectOption('小野田');
  await desktopPage.locator('[name=onodaQuantity]').fill('2.5');
  await save(desktopPage, '日程を保存');

  await desktopPage.locator('[name=title]').fill('隔離現金施工');
  await save(desktopPage, '日程を保存');
  desktopPage.once('dialog', dialog => { void dialog.accept('4620'); });
  await desktopPage.getByRole('row').filter({hasText: '隔離現金施工'})
    .getByRole('button', {name: '現金施工を確定'}).click();
  await desktopPage.getByText('売上と現金入金を確定しました').waitFor({timeout});

  await navigate(desktopPage, '帳票');
  for (const [type, label] of [['estimate', '見積試験'], ['invoice', '請求試験'], ['receipt', '領収試験']]) {
    await desktopPage.locator('[name=docType]').selectOption(type);
    await desktopPage.locator('[name=customerName]').fill('隔離試験株式会社');
    await desktopPage.locator('[name=amount]').fill('10000');
    await desktopPage.locator('[name=description]').fill(label);
    if (type === 'invoice') await desktopPage.locator('[name=discount]').fill('1000');
    await save(desktopPage, '帳票を正式保存');
  }

  await navigate(desktopPage, '日程');
  await desktopPage.getByRole('button', {name: '小野田明細読込 → 請求書'}).click();
  const onoda = desktopPage.getByRole('dialog');
  const day = await desktopPage.locator('[data-action=schedule] [name=date]').inputValue();
  await onoda.locator('[name=customerName]').fill('小野田試験株式会社');
  await onoda.locator('[name=invoiceDate]').fill(day);
  await onoda.locator('[name=unitPrice]').fill('1200');
  await onoda.locator('[name=taxable]').selectOption('taxable');
  await onoda.getByRole('button', {name: '明細を読み込む'}).click();
  await desktopPage.getByText(/消費税 300 円.*合計 3,300 円/).waitFor({timeout});
  await save(desktopPage, '小野田請求書を正式発行');

  await navigate(desktopPage, '支出・現金');
  await desktopPage.locator('[name=vendor]').fill('隔離現金支出');
  await desktopPage.locator('[name=amount]').fill('500');
  await save(desktopPage, '支出登録');
  await desktopPage.getByText('支払済', {exact: true}).waitFor({timeout});
  await desktopPage.locator('[name=vendor]').fill('隔離代表者立替');
  await desktopPage.locator('[name=amount]').fill('1500');
  await desktopPage.locator('[name=paymentMethod]').selectOption('代表者立替');
  await save(desktopPage, '支出登録');
  await desktopPage.getByText('立替未精算', {exact: true}).waitFor({timeout});

  await navigate(desktopPage, '売上・入金');
  const invoiceRow = desktopPage.getByRole('row').filter({hasText: '9,900 円'});
  const invoiceSale = await invoiceRow.getByRole('cell').nth(5).innerText();
  await desktopPage.locator('[name=saleId]').selectOption(invoiceSale);
  await desktopPage.locator('[name=amount]').fill('9900');
  await desktopPage.locator('[name=method]').selectOption('銀行振込');
  await save(desktopPage, '入金登録');
  await desktopPage.getByText(/pending-bank/).waitFor({timeout});

  await navigate(desktopPage, '銀行照合');
  const csv = Buffer.from('日付,摘要,入金,出金,取引番号\n' + day + ',隔離入金,9900,,test123\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    await desktopPage.locator('[name=account]').fill('隔離口座');
    await desktopPage.locator('[name=csv]').setInputFiles({name: 'bank.csv', mimeType: 'text/csv', buffer: csv});
    await save(desktopPage, '銀行CSVを取り込む');
  }
  assert.equal(await desktopPage.getByText('隔離入金', {exact: true}).count(), 1);
  desktopPage.once('dialog', dialog => {
    desktopPage.once('dialog', confirmation => { void confirmation.accept(); });
    void dialog.accept(dialog.defaultValue());
  });
  await desktopPage.getByRole('button', {name: '候補を確認'}).click();
  await desktopPage.getByText('matched', {exact: true}).waitFor({timeout});
  desktopPage.once('dialog', dialog => { void dialog.accept(); });
  await desktopPage.getByRole('button', {name: '照合解除'}).click();
  await desktopPage.getByText('unmatched', {exact: true}).waitFor({timeout});

  if (evidence) await mkdir(evidence, {recursive: true});
  await navigate(desktopPage, '保存帳票');
  for (const type of ['estimate', 'invoice', 'receipt', 'onoda']) {
    const row = desktopPage.getByRole('row').filter({has: desktopPage.getByRole('cell', {name: type, exact: true})});
    const pdfResponse = desktopPage.waitForResponse(response => response.url().includes('/api/pdf?'), {timeout: 45_000});
    await row.getByRole('button', {name: '原版PDF'}).click();
    const result = await pdfResponse;
    assert.equal(result.status(), 200, 'PDF ' + type);
    const bytes = await result.body();
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    const dialog = desktopPage.getByRole('dialog');
    const preview = await dialog.locator('iframe').getAttribute('src');
    const download = await dialog.getByRole('link', {name: 'PDFをダウンロード'}).getAttribute('href');
    assert.equal(preview, download);
    const received = desktopPage.waitForEvent('download');
    await dialog.getByRole('link', {name: 'PDFをダウンロード'}).click();
    const file = await received;
    assert.deepEqual(await readFile(await file.path()), bytes);
    if (evidence) await writeFile(join(evidence, type + '.pdf'), bytes);
    await dialog.getByRole('button', {name: '閉じる'}).click();
  }

  await mobile.setOffline(true);
  await mobilePage.getByText(/オフラインです/).waitFor({timeout});
  await mobile.setOffline(false);
  await mobilePage.getByText(/オフラインです/).waitFor({state: 'hidden', timeout});
  if (evidence) {
    for (const [index, label] of pages.entries()) {
      for (const [size, page] of [['desktop', desktopPage], ['mobile', mobilePage]]) {
        await navigate(page, label);
        await page.screenshot({path: join(evidence, size + '-' + (index + 1) + '.png'), fullPage: true});
      }
    }
  }

  const staff = await browser.newPage();
  await login(staff, identities.staff);
  await navigate(staff, '設定');
  assert.equal(await staff.locator('[name=name]').count(), 0);
  const outside = await browser.newPage();
  await login(outside, identities.outsider);
  await outside.getByText('この会社の操作権限がありません').waitFor({timeout});
  assert.equal(await outside.locator('#workspace').isVisible(), false);
  assert.deepEqual(jsErrors, []);

  // Restore real records and binary archive chunks into an empty, separate database.
  const db = getFirestore(adminApp);
  const restoreDb = getFirestore(adminApp, 'linchen-restore');
  const source = db.collection('companies').doc(companyId);
  const restored = restoreDb.collection('companies').doc(companyId);
  const paths = ['settings', 'customers', 'projects', 'schedule', 'documents', 'sales', 'payments',
    'expenses', 'cashLedger', 'bankTransactions', 'suppliers', 'supplierTransactions', 'auditLogs',
    'operations', 'documentNumbers', 'pdfArchives'];
  function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
  const dataset = {};
  for (const name of paths) {
    const group = await source.collection(name).get();
    dataset[name] = group.docs.map(record => ({id: record.id, data: record.data()}));
  }
  for (const archive of dataset.pdfArchives) {
    const rows = await source.collection('pdfArchives').doc(archive.id).collection('chunks').get();
    dataset['pdfArchives/' + archive.id + '/chunks'] = rows.docs.map(record => ({id: record.id, data: record.data()}));
  }
  const bank = dataset.settings.find(record => record.data.payload.type === 'bankCSV').data.payload;
  assert.equal(hash(Buffer.from(bank.data, 'base64')), hash(csv));
  assert.equal(dataset.pdfArchives.length, 4);
  assert.equal(new Set(dataset.documents.map(record => record.data.payload.invoiceNo)).size, 4);
  const onodaInvoice = dataset.documents.find(record => record.data.payload.docType === 'onoda').data.payload;
  assert.equal(onodaInvoice.amount, 3300);
  assert.equal(onodaInvoice.snapshot.items[0].price, 1200);
  assert.ok(onodaInvoice.snapshot.items[0].sourceEventId);
  const cashSale = dataset.sales.find(record => record.data.payload.description === '' && record.data.payload.amount === 4620);
  const cashPayment = dataset.payments.find(record => record.data.payload.saleId === cashSale.id);
  assert.equal(cashPayment.data.payload.confirmation, 'cash-received');
  assert.equal(dataset.cashLedger.find(record => record.data.payload.sourceId === cashPayment.id).data.payload.amount, 4620);
  const exportRoot = await mkdtemp(join(tmpdir(), 'linchen-restore-'));
  t.after(() => rm(exportRoot, {recursive: true, force: true}));
  const exportPath = join(exportRoot, 'backup.json');
  const backupBytes = Buffer.from(JSON.stringify(dataset));
  await writeFile(exportPath, backupBytes, {mode: 0o600});
  const bytesFromDisk = await readFile(exportPath);
  assert.equal(hash(bytesFromDisk), hash(backupBytes));
  // This decoder handles the only Firestore-specific types in this synthetic backup.
  const backup = JSON.parse(bytesFromDisk.toString(), (_, value) => {
    if (value && typeof value === 'object') {
      if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
      if (Number.isInteger(value._seconds) && Number.isInteger(value._nanoseconds)) {
        return new Timestamp(value._seconds, value._nanoseconds);
      }
    }
    return value;
  });
  const batch = restoreDb.batch();
  for (const [name, entries] of Object.entries(backup)) {
    assert.equal((await restored.collection(name).get()).size, 0);
    for (const entry of entries) batch.create(restored.collection(name).doc(entry.id), entry.data);
  }
  await batch.commit();
  for (const [name, entries] of Object.entries(dataset)) {
    const result = await restored.collection(name).get();
    assert.deepEqual(result.docs.map(record => ({id: record.id, data: record.data()})), entries);
  }
  for (const archive of dataset.pdfArchives) {
    const rows = await restored.collection('pdfArchives').doc(archive.id).collection('chunks').get();
    const bytes = Buffer.concat(rows.docs.sort((a, b) => Number(a.id) - Number(b.id)).map(row => row.get('bytes')));
    assert.equal(hash(bytes), archive.data.sha256);
  }
  if (evidence) {
    const summary = {
      scope: 'synthetic records only, source Firestore emulator → empty named Firestore database',
      counts: Object.fromEntries(Object.entries(dataset).map(([name, rows]) => [name, rows.length])),
      backupSha256: hash(bytesFromDisk),
      csvSha256: bank.sha256,
      pdfSha256: dataset.pdfArchives.map(({data}) => ({id: data.documentId, invoiceNo: data.invoiceNo, sha256: data.sha256})),
      documents: dataset.documents.map(({data: {payload}}) =>
        ({id: payload.id, type: payload.docType, amount: payload.amount, invoiceNo: payload.invoiceNo})),
      restoredCashBalance: dataset.cashLedger.reduce((sum, {data: {payload}}) =>
        payload.deletedAt ? sum : sum + (payload.type === 'income' ? 1 : -1) * payload.amount, 0),
    };
    await writeFile(join(evidence, 'restore-verification.json'), JSON.stringify(summary, null, 2) + '\n');
  }
});

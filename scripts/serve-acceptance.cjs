'use strict';

const {createServer} = require('node:http');
const {createReadStream, existsSync} = require('node:fs');
const {join} = require('node:path');
const {Readable} = require('node:stream');
const {applicationDefault, initializeApp} = require('firebase-admin/app');
const {createCommandHandler} = require('../services/api/commands.cjs');
const {closeBrowser} = require('./pdf-export.cjs');

const root = join(__dirname, '..');
const assets = new Map([
  ['/', ['app/acceptance.html', 'text/html']],
  ['/app/workbench.css', ['app/workbench.css', 'text/css']],
  ['/app/acceptance.css', ['app/acceptance.css', 'text/css']],
  ['/app/acceptance.js', ['dist/acceptance.js', 'text/javascript']],
  ['/app/workbench.js', ['app/workbench.js', 'text/javascript']],
  ...['core/document-numbering', 'core/business', 'core/schedule-calendar', 'core/views', 'core/document-totals']
    .map(name => ['/src/' + name + '.js', ['src/' + name + '.js', 'text/javascript']]),
]);

function serve({projectId, companyId, apiKey, authDomain, appId, port = 4183, cloud = false, credential}) {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (cloud) {
    if (projectId !== 'linchen-acceptance-20261116' || authHost || firestoreHost ||
        authDomain !== projectId + '.firebaseapp.com') {
      throw Error('Cloud acceptance requires the dedicated Firebase project without any emulator override');
    }
  } else if (!/^demo-[a-z0-9-]+$/.test(projectId || '') ||
      !/^127\.0\.0\.1:\d+$/.test(authHost || '') || !/^127\.0\.0\.1:\d+$/.test(firestoreHost || '')) {
    throw Error('The local acceptance server requires isolated loopback Firebase emulators');
  }
  if (!apiKey || !authDomain || !appId) throw Error('Firebase browser configuration is required');
  if (!existsSync(join(root, 'dist/acceptance.js'))) throw Error('Run npm run build:acceptance first');
  const authEmulator = cloud ? null : 'http://' + authHost;
  const authOrigins = cloud ? 'https://identitytoolkit.googleapis.com https://securetoken.googleapis.com' : authEmulator;
  const configuration = {firebase: {projectId, apiKey, authDomain, appId}, authEmulator, companyId, cloud};
  const app = initializeApp({projectId, ...(cloud ? {credential: credential || applicationDefault()} : {})});
  const handler = createCommandHandler({app, companyId, requireAdminMfa: cloud});
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', [
      "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
      "connect-src 'self' " + authOrigins, "frame-src blob:", "object-src 'none'",
      "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ].join('; '));
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname.startsWith('/api/')) {
        const request = new Request(url, {
          method: req.method, headers: req.headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : {body: Readable.toWeb(req), duplex: 'half'}),
        });
        const result = await handler(request);
        res.writeHead(result.status, Object.fromEntries(result.headers));
        if (result.body) Readable.fromWeb(result.body).pipe(res);
        else res.end();
        return;
      }
      if (req.method !== 'GET') return res.writeHead(405).end();
      if (url.pathname === '/configuration.json') {
        return res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(configuration));
      }
      const asset = assets.get(url.pathname);
      if (!asset) return res.writeHead(404).end();
      res.writeHead(200, {'Content-Type': asset[1] + '; charset=utf-8'});
      createReadStream(join(root, asset[0])).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end();
    }
  });
  server.on('close', () => closeBrowser().catch(() => {}));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, cloud ? '0.0.0.0' : '127.0.0.1', () => resolve(server));
  });
}

if (require.main === module) {
  const cloud = process.env.LINCHEN_CLOUD_ACCEPTANCE === '1';
  serve({
    cloud,
    projectId: process.env.GCLOUD_PROJECT, companyId: process.env.LINCHEN_COMPANY,
    apiKey: cloud ? process.env.LINCHEN_FIREBASE_API_KEY : 'local-emulator',
    authDomain: cloud ? process.env.GCLOUD_PROJECT + '.firebaseapp.com' : 'localhost',
    appId: cloud ? process.env.LINCHEN_FIREBASE_APP_ID : 'local-emulator',
    port: Number(process.env.PORT || 4183),
  }).then(server => console.log('Linchen acceptance listening on port ' + server.address().port));
}

module.exports = {serve};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PDF_API_KEY = process.env.PDF_API_KEY || 'test-api-key';
process.env.OUTPUT_DIR = process.env.OUTPUT_DIR || './output-test';
process.env.LOG_LEVEL = 'silent';

const { buildApp } = require('../src/app');
const { closeBrowser, getBrowser } = require('../src/browser');

const API_KEY = process.env.PDF_API_KEY;

// Detecta, em tempo de execução, se o Chromium do Playwright está
// disponível neste ambiente. Em sandboxes sem acesso à internet o binário
// pode não estar instalado; nesse caso os testes que dependem de
// renderização real de PDF são pulados (mas o restante da suíte roda).
let chromiumAvailable = null;
async function isChromiumAvailable() {
  if (chromiumAvailable !== null) return chromiumAvailable;
  try {
    await getBrowser();
    chromiumAvailable = true;
  } catch (err) {
    chromiumAvailable = false;
  }
  return chromiumAvailable;
}

test('GET /health returns ok without API key', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'html-to-pdf-service' });
  await app.close();
});

test('POST /v1/pdf without API key returns 401', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    payload: { html: '<html><body>Hi</body></html>' },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { success: false, error: 'Unauthorized' });
  await app.close();
});

test('POST /v1/pdf with invalid API key returns 401', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    headers: { 'x-api-key': 'wrong-key' },
    payload: { html: '<html><body>Hi</body></html>' },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('POST /v1/pdf with empty html returns 400', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    headers: { 'x-api-key': API_KEY },
    payload: { html: '' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().success, false);
  await app.close();
});

test('POST /v1/pdf with missing html returns 400', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    headers: { 'x-api-key': API_KEY },
    payload: {},
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test('POST /v1/pdf generates a valid PDF with correct API key', async (t) => {
  if (!(await isChromiumAvailable())) {
    t.skip('Chromium não está instalado neste ambiente (npx playwright install chromium)');
    return;
  }

  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    headers: { 'x-api-key': API_KEY },
    payload: {
      html: '<!DOCTYPE html><html><head><style>body{font-family:Arial}</style></head><body><h1>Teste</h1></body></html>',
      options: { format: 'A4', printBackground: true },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  const buffer = response.rawPayload;
  assert.ok(buffer.length > 0);
  assert.equal(buffer.slice(0, 5).toString('utf8'), '%PDF-');

  await app.close();
});

test('POST /v1/pdf generates a PDF from long HTML', async (t) => {
  if (!(await isChromiumAvailable())) {
    t.skip('Chromium não está instalado neste ambiente (npx playwright install chromium)');
    return;
  }

  const paragraph = '<p>Linha de relatório com texto suficiente para simular um documento longo, com tabelas e quebras de página.</p>';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}p{margin:0 0 8px}</style></head><body><h1>Relatório longo</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">${paragraph.repeat(4000)}</body></html>`;

  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf',
    headers: { 'x-api-key': API_KEY },
    payload: {
      html,
      options: { format: 'A4', printBackground: true, waitUntil: 'domcontentloaded' },
    },
  });

  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.rawPayload.slice(0, 5).toString('utf8'), '%PDF-');
  assert.ok(response.rawPayload.length > 5000);

  await app.close();
});

test('POST /v1/pdf/file generates and saves a PDF, returning a URL', async (t) => {
  if (!(await isChromiumAvailable())) {
    t.skip('Chromium não está instalado neste ambiente (npx playwright install chromium)');
    return;
  }

  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pdf/file',
    headers: { 'x-api-key': API_KEY },
    payload: { html: '<html><body><p>Arquivo salvo</p></body></html>' },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.success, true);
  assert.match(body.id, /^pdf_[a-f0-9]+$/);
  assert.match(body.filename, /^pdf_[a-f0-9]+\.pdf$/);
  assert.ok(body.url.includes(body.filename));

  await app.close();
});

test.after(async () => {
  await closeBrowser();
});

'use strict';

const http = require('http');
const { getBrowser } = require('./browser');

class PdfTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfTimeoutError';
  }
}

const ALLOWED_WAIT_UNTIL = new Set(['commit', 'domcontentloaded', 'load', 'networkidle']);

const ALLOWED_PDF_OPTIONS = [
  'format',
  'width',
  'height',
  'landscape',
  'margin',
  'printBackground',
  'preferCSSPageSize',
  'scale',
  'displayHeaderFooter',
  'headerTemplate',
  'footerTemplate',
];

const DEFAULT_OPTIONS = {
  format: 'A4',
  landscape: false,
  printBackground: true,
  preferCSSPageSize: true,
};

function buildPdfOptions(userOptions = {}) {
  const result = { ...DEFAULT_OPTIONS };

  for (const key of ALLOWED_PDF_OPTIONS) {
    if (userOptions[key] !== undefined && userOptions[key] !== null) {
      result[key] = userOptions[key];
    }
  }

  // width/height são incompatíveis com "format" no Playwright.
  // Se o usuário informar width/height explicitamente, o format é descartado.
  if (result.width || result.height) {
    delete result.format;
  }

  return result;
}

function timeout(ms) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new PdfTimeoutError('PDF generation timeout'));
    }, ms);
    // Não impede o processo de encerrar caso ainda esteja pendente
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function resolveWaitUntil(options = {}) {
  const value = options && options.waitUntil;
  if (typeof value === 'string' && ALLOWED_WAIT_UNTIL.has(value)) {
    return value;
  }
  // networkidle quase nunca estabiliza em HTML longo (muitas imagens ou
  // conexões abertas) e faz a geração estourar o timeout.
  return 'domcontentloaded';
}

/**
 * Entrega o HTML ao Chromium por HTTP local.
 * page.setContent manda o documento inteiro pelo protocolo do DevTools e
 * falha (ou trava) quando o HTML é grande. O browser busca o arquivo por
 * HTTP, então o tamanho fica limitado só por MAX_HTML_SIZE_MB.
 */
function serveHtml(html) {
  const body = Buffer.from(html, 'utf8');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'Connection': 'close',
      });
      res.end(body);
    });

    server.keepAliveTimeout = 1;
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close() {
          return new Promise((done) => {
            const timer = setTimeout(done, 1000);
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
            server.close(() => {
              clearTimeout(timer);
              done();
            });
          });
        },
      });
    });
  });
}

/**
 * Aguarda fontes e imagens, mas desiste depois de budgetMs.
 * Um recurso remoto que não responde não pode segurar o PDF inteiro.
 */
async function waitForResources(page, budgetMs) {
  await page.evaluate(async (budget) => {
    const work = (async () => {
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (err) {
          // segue mesmo se falhar
        }
      }

      const images = Array.from(document.images || []);
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        })
      );
    })();

    await Promise.race([
      work,
      new Promise((resolve) => setTimeout(resolve, budget)),
    ]);
  }, budgetMs);
}

async function renderHtmlToPdf({ html, options = {}, timeoutMs = 60000 }) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  let served = null;

  try {
    served = await serveHtml(html);
    const waitUntil = resolveWaitUntil(options);
    const resourceBudgetMs = Math.min(20000, timeoutMs);

    const generation = (async () => {
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      await page.goto(served.url, { waitUntil, timeout: timeoutMs });
      await waitForResources(page, resourceBudgetMs);

      const pdfOptions = buildPdfOptions(options);
      return page.pdf(pdfOptions);
    })();

    return await Promise.race([generation, timeout(timeoutMs)]);
  } finally {
    await context.close().catch(() => {});
    if (served) await served.close().catch(() => {});
  }
}

module.exports = { renderHtmlToPdf, buildPdfOptions, resolveWaitUntil, PdfTimeoutError };

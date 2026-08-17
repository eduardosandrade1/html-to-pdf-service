'use strict';

const { getBrowser } = require('./browser');

class PdfTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfTimeoutError';
  }
}

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

/**
 * Aguarda fontes e imagens carregarem dentro da página antes de
 * considerar o conteúdo pronto para impressão em PDF.
 */
async function waitForResources(page) {
  await page.evaluate(async () => {
    // Aguarda fontes (document.fonts é suportado em Chromium)
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (err) {
        // segue mesmo se falhar
      }
    }

    // Aguarda todas as imagens (incluindo base64/data URI, que resolvem quase
    // imediatamente, e imagens externas, que dependem da rede)
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
  });
}

async function renderHtmlToPdf({ html, options = {}, timeoutMs = 60000 }) {
  const browser = await getBrowser();
  const context = await browser.newContext();

  try {
    const generation = (async () => {
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      await page.setContent(html, { waitUntil: 'networkidle', timeout: timeoutMs });
      await waitForResources(page);

      const pdfOptions = buildPdfOptions(options);
      const buffer = await page.pdf(pdfOptions);
      return buffer;
    })();

    const buffer = await Promise.race([generation, timeout(timeoutMs)]);
    return buffer;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { renderHtmlToPdf, buildPdfOptions, PdfTimeoutError };

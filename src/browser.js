'use strict';

const { chromium } = require('playwright');

let browserPromise = null;

/**
 * Retorna a instância global e reutilizável do Chromium.
 * O browser é iniciado apenas uma vez (lazy) e reaproveitado
 * em todas as requisições, evitando o custo de abrir um novo
 * processo Chromium a cada geração de PDF.
 */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    }).catch((err) => {
      // Se o lançamento falhar, permite tentar novamente na próxima chamada
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Encerra o browser de forma segura. Deve ser chamado no shutdown
 * do processo (SIGTERM/SIGINT) para não deixar processos órfãos.
 */
async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (err) {
    // Ignora erros no encerramento, o processo está finalizando de qualquer forma
  } finally {
    browserPromise = null;
  }
}

module.exports = { getBrowser, closeBrowser };

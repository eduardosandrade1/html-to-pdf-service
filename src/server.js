'use strict';

const config = require('./config');
const { buildApp } = require('./app');
const { getBrowser, closeBrowser } = require('./browser');
const { startCleanupJob, cleanupOldFiles } = require('./storage');

async function start() {
  const app = buildApp();

  let cleanupTimer = null;
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'shutting down gracefully');

    if (cleanupTimer) clearInterval(cleanupTimer);

    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'error closing fastify server');
    }

    try {
      await closeBrowser();
    } catch (err) {
      app.log.error({ err }, 'error closing browser');
    }

    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    // Warm up: inicia o Chromium uma vez no boot para que a primeira
    // requisição não pague o custo de lançar o browser.
    await getBrowser();
    app.log.info('Chromium browser warmed up');

    // Limpeza inicial + rotina periódica de retenção de arquivos
    await cleanupOldFiles(config.retentionHours, app.log).catch(() => {});
    cleanupTimer = startCleanupJob(app.log);

    await app.listen({ host: config.host, port: config.port });
    app.log.info(`html-to-pdf-service listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

start();

'use strict';

const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const helmet = require('@fastify/helmet');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const fastifyStatic = require('@fastify/static');

const config = require('./config');
const { requireApiKey } = require('./auth');
const { validatePdfRequest, ValidationError } = require('./validation');
const { renderHtmlToPdf, PdfTimeoutError } = require('./pdf');
const { savePdf, resolveSafeFilePath, ensureOutputDirSync } = require('./storage');

function buildApp(opts = {}) {
  ensureOutputDirSync();

  const app = Fastify({
    logger: opts.logger !== undefined ? opts.logger : {
      level: config.logLevel,
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      // Redação: nunca registrar API keys nos logs
      redact: {
        paths: ['req.headers["x-api-key"]', 'headers["x-api-key"]'],
        censor: '[redacted]',
      },
    },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: true,
  });

  // ---------------------------------------------------------------------
  // Plugins de segurança e infraestrutura
  // ---------------------------------------------------------------------
  app.register(helmet, { contentSecurityPolicy: false });

  app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
  });

  app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    errorResponseBuilder: () => ({ success: false, error: 'Too many requests' }),
  });

  app.register(fastifyStatic, {
    root: config.outputDir,
    prefix: '/files/',
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
  });

  // ---------------------------------------------------------------------
  // Hooks de observabilidade (log estruturado, sem expor HTML/API keys)
  // ---------------------------------------------------------------------
  app.addHook('onRequest', async (request) => {
    request.startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const elapsedMs = Number(process.hrtime.bigint() - request.startTime) / 1e6;
    request.log.info({
      endpoint: request.routeOptions ? request.routeOptions.url : request.url,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Math.round(elapsedMs),
    }, 'request completed');
  });

  // ---------------------------------------------------------------------
  // Rotas
  // ---------------------------------------------------------------------

  app.get('/health', async () => ({ status: 'ok', service: 'html-to-pdf-service' }));

  app.register(async (v1) => {
    v1.addHook('preHandler', requireApiKey);

    v1.post('/pdf', async (request, reply) => {
      const { html, options, htmlSizeBytes } = validatePdfRequest(request.body);

      const startedAt = process.hrtime.bigint();
      const buffer = await renderHtmlToPdf({ html, options, timeoutMs: config.pdfTimeoutMs });
      const generationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      request.log.info({
        endpoint: '/v1/pdf',
        htmlSizeBytes,
        pdfGenerationMs: Math.round(generationMs),
        pdfSizeBytes: buffer.length,
      }, 'pdf generated');

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Length', buffer.length)
        .send(buffer);
    });

    v1.post('/pdf/file', async (request, reply) => {
      const { html, options, htmlSizeBytes } = validatePdfRequest(request.body);

      const startedAt = process.hrtime.bigint();
      const buffer = await renderHtmlToPdf({ html, options, timeoutMs: config.pdfTimeoutMs });
      const generationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      const saved = await savePdf(buffer);

      request.log.info({
        endpoint: '/v1/pdf/file',
        htmlSizeBytes,
        pdfGenerationMs: Math.round(generationMs),
        pdfSizeBytes: buffer.length,
        fileId: saved.id,
      }, 'pdf generated and saved');

      reply.code(201).send({
        success: true,
        id: saved.id,
        filename: saved.filename,
        url: `${config.baseUrl}${saved.url}`,
      });
    });
  }, { prefix: '/v1' });

  // GET /files/:filename é servido pelo plugin @fastify/static acima.
  // Adicionamos uma validação extra de segurança contra path traversal
  // via hook, já que o plugin estático também normaliza o path.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/files/')) {
      const requested = decodeURIComponent(request.url.replace('/files/', '').split('?')[0]);
      const safePath = resolveSafeFilePath(requested);
      if (!safePath || !fs.existsSync(safePath)) {
        reply.code(404).send({ success: false, error: 'File not found' });
      }
    }
  });

  // ---------------------------------------------------------------------
  // Tratamento global de erros — nunca expor stack traces ao cliente
  // ---------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) {
      const statusCode = error.tooLarge ? 413 : 400;
      return reply.code(statusCode).send({ success: false, error: error.message });
    }

    if (error instanceof PdfTimeoutError) {
      return reply.code(504).send({ success: false, error: 'PDF generation timeout' });
    }

    if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ success: false, error: 'HTML payload too large' });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({ success: false, error: 'Too many requests' });
    }

    if (error.validation || error.statusCode === 400) {
      return reply.code(400).send({ success: false, error: 'Invalid request' });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ success: false, error: 'Internal server error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ success: false, error: 'Not found' });
  });

  return app;
}

module.exports = { buildApp };

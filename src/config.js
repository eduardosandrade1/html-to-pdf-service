'use strict';

require('dotenv').config();
const path = require('path');

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_HTML_SIZE_MB = toFloat(process.env.MAX_HTML_SIZE_MB, 10);

const config = {
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.PDF_API_KEY || 'change-me',
  maxHtmlSizeMb: MAX_HTML_SIZE_MB,
  // Extra margin above the raw HTML limit so the JSON envelope (options, keys)
  // doesn't get rejected for being a few bytes over the limit.
  bodyLimitBytes: Math.ceil(MAX_HTML_SIZE_MB * 1024 * 1024 * 1.1) + 4096,
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR || './output'),
  baseUrl: (process.env.PDF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  retentionHours: toFloat(process.env.PDF_RETENTION_HOURS, 24),
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  pdfTimeoutMs: toInt(process.env.PDF_TIMEOUT_MS, 60000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 60),
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  cleanupIntervalMs: toInt(process.env.CLEANUP_INTERVAL_MS, 15 * 60 * 1000),
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
};

module.exports = config;

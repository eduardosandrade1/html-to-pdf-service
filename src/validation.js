'use strict';

const config = require('./config');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Valida o corpo da requisição para os endpoints de geração de PDF.
 * Lança ValidationError com uma mensagem amigável em caso de problema.
 */
function validatePdfRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Invalid request body');
  }

  const { html, options } = body;

  if (html === undefined || html === null) {
    throw new ValidationError('The "html" field is required');
  }

  if (typeof html !== 'string') {
    throw new ValidationError('The "html" field must be a string');
  }

  if (html.trim().length === 0) {
    throw new ValidationError('The "html" field cannot be empty');
  }

  const htmlSizeBytes = Buffer.byteLength(html, 'utf8');
  const maxBytes = config.maxHtmlSizeMb * 1024 * 1024;
  if (htmlSizeBytes > maxBytes) {
    const err = new ValidationError('HTML payload too large');
    err.tooLarge = true;
    throw err;
  }

  if (options !== undefined && (typeof options !== 'object' || Array.isArray(options) || options === null)) {
    throw new ValidationError('The "options" field must be an object');
  }

  return {
    html,
    options: options || {},
    htmlSizeBytes,
  };
}

module.exports = { validatePdfRequest, ValidationError };

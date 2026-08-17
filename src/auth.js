'use strict';

const config = require('./config');

/**
 * Fastify preHandler hook que exige um header X-API-Key válido.
 * Deve ser aplicado apenas às rotas /v1/*; o /health permanece público.
 */
async function requireApiKey(request, reply) {
  const providedKey = request.headers['x-api-key'];

  if (!providedKey || providedKey !== config.apiKey) {
    reply.code(401).send({ success: false, error: 'Unauthorized' });
  }
}

module.exports = { requireApiKey };

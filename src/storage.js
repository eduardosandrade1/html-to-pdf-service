'use strict';

const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// Apenas letras, números, hífen e underscore são aceitos em nomes de arquivo.
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.pdf$/;

function ensureOutputDirSync() {
  if (!fssync.existsSync(config.outputDir)) {
    fssync.mkdirSync(config.outputDir, { recursive: true });
  }
}

function generateId() {
  return `pdf_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Salva o buffer do PDF em disco com um nome de arquivo gerado
 * internamente (nunca a partir de input do usuário), evitando
 * qualquer possibilidade de path traversal.
 */
async function savePdf(buffer) {
  ensureOutputDirSync();

  const id = generateId();
  const filename = `${id}.pdf`;
  const filepath = path.join(config.outputDir, filename);

  await fs.writeFile(filepath, buffer);

  return {
    id,
    filename,
    url: `/files/${filename}`,
  };
}

/**
 * Resolve o caminho absoluto de um arquivo solicitado pelo cliente,
 * validando rigorosamente o nome para impedir path traversal
 * (ex: "../../etc/passwd") ou acesso fora do diretório de output.
 */
function resolveSafeFilePath(requestedFilename) {
  if (typeof requestedFilename !== 'string' || !SAFE_FILENAME_REGEX.test(requestedFilename)) {
    return null;
  }

  const basename = path.basename(requestedFilename);
  const filepath = path.join(config.outputDir, basename);
  const resolved = path.resolve(filepath);
  const outputDirResolved = path.resolve(config.outputDir);

  if (!resolved.startsWith(outputDirResolved + path.sep) && resolved !== outputDirResolved) {
    return null;
  }

  return resolved;
}

/**
 * Remove arquivos do diretório de output com mais de `retentionHours`.
 * Roda periodicamente em segundo plano sem bloquear a API.
 */
async function cleanupOldFiles(retentionHours = config.retentionHours, logger = console) {
  ensureOutputDirSync();

  const maxAgeMs = retentionHours * 60 * 60 * 1000;
  const now = Date.now();

  let entries;
  try {
    entries = await fs.readdir(config.outputDir);
  } catch (err) {
    logger.warn({ err }, 'Failed to read output directory during cleanup');
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry === '.gitkeep' || !entry.endsWith('.pdf')) return;

      const filepath = path.join(config.outputDir, entry);
      try {
        const stats = await fs.stat(filepath);
        const age = now - stats.mtimeMs;
        if (age > maxAgeMs) {
          await fs.unlink(filepath);
        }
      } catch (err) {
        // Arquivo pode já ter sido removido por outra execução; ignora.
      }
    })
  );
}

/**
 * Inicia a rotina periódica de limpeza. Retorna um handle de timer
 * que pode ser usado para pará-la (útil em testes e shutdown).
 */
function startCleanupJob(logger = console) {
  const timer = setInterval(() => {
    cleanupOldFiles(config.retentionHours, logger).catch((err) => {
      logger.warn({ err }, 'Cleanup job failed');
    });
  }, config.cleanupIntervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  savePdf,
  resolveSafeFilePath,
  cleanupOldFiles,
  startCleanupJob,
  generateId,
  ensureOutputDirSync,
  SAFE_FILENAME_REGEX,
};

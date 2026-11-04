'use strict';

class RagError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'RagError';
    this.code = code;
    this.status = status;
  }
}

function isRagError(error) {
  return error instanceof RagError || Boolean(
    error && typeof error.code === 'string' && Number.isInteger(error.status)
  );
}

function publicError(error) {
  if (isRagError(error)) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message
      }
    };
  }

  return {
    status: 503,
    body: {
      code: 'RAG_INTERNAL_ERROR',
      message: 'The mission RAG service failed.'
    }
  };
}

function rethrowRag(error, fallbackCode, fallbackStatus, fallbackMessage) {
  if (isRagError(error)) throw error;
  throw new RagError(fallbackCode, fallbackStatus, fallbackMessage);
}

module.exports = { RagError, isRagError, publicError, rethrowRag };

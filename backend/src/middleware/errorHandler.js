const postgresDiagnosticFields = [
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
];

function postgresDiagnostics(error) {
  if (!/^[0-9A-Z]{5}$/.test(error.code || '')) return {};

  const diagnostics = Object.fromEntries(postgresDiagnosticFields.flatMap((field) => {
    const value = error[field];
    return typeof value === 'string' && value.length > 0 && value.length <= 128
      ? [[field, value]]
      : [];
  }));
  if (typeof error.message === 'string') {
    if (error.code === '42P01') {
      const relation = error.message.match(/relation "([^"]+)" does not exist/i)?.[1];
      if (relation && relation.length <= 128) diagnostics.missingRelation = relation;
    }
    if (error.code === '23502') {
      const match = error.message.match(/null value in column "([^"]+)" of relation "([^"]+)"/i);
      if (match) {
        diagnostics.column ||= match[1].slice(0, 128);
        diagnostics.table ||= match[2].slice(0, 128);
      }
    }
  }
  return diagnostics;
}

function safeErrorCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_:-]{1,64}$/i.test(value)
    ? value
    : 'Error';
}

export function errorHandler({ logger = console }) {
  return (error, request, response, _next) => {
    const statusCode = Number.isInteger(error.statusCode)
      ? error.statusCode
      : Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
      : error.type === 'entity.parse.failed'
        ? 400
        : error.type === 'entity.too.large'
          ? 413
          : 500;
    if (statusCode >= 500) {
      logger.error('Unhandled API error:', {
        ...(request.requestId ? { request_id: request.requestId } : {}),
        method: request.method,
        path: request.route?.path
          ? `${request.baseUrl || ''}${request.route.path}`
          : request.path,
        status_code: statusCode,
        ...(typeof request.requestStartedAt === 'bigint'
          ? { duration_ms: Number((process.hrtime.bigint() - request.requestStartedAt) / 1_000_000n) }
          : {}),
        ...(request.uploadStage ? { stage: request.uploadStage } : {}),
        ...(Number.isInteger(request.uploadFileCount)
          ? { file_count: request.uploadFileCount }
          : {}),
        ...(Number.isSafeInteger(request.uploadFileSizeBytes)
          ? { file_size_bytes: request.uploadFileSizeBytes }
          : {}),
        ...(request.uploadCleanup ? { cleanup: request.uploadCleanup } : {}),
        ...(request.uploadCleanupErrorCode
          ? { cleanup_error_code: safeErrorCode(request.uploadCleanupErrorCode) }
          : {}),
        code: safeErrorCode(error.code || error.name),
        ...(typeof error.rollbackError?.code === 'string'
          ? { rollback_error_code: safeErrorCode(error.rollbackError.code) }
          : {}),
        ...(/^[0-9A-Z]{5}$/.test(error.code || '')
          ? { sqlstate: error.code }
          : {}),
        ...postgresDiagnostics(error),
      });
    }
    response.status(statusCode).json({
      error: {
        status_code: statusCode,
        message: statusCode >= 500 ? 'The server encountered an error.' : error.message,
        details: error.details || {},
      },
    });
  };
}

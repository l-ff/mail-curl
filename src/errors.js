export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || "app_error";
    this.statusCode = options.statusCode || 500;
    this.details = options.details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Invalid key") {
    super(message, {
      code: "unauthorized",
      statusCode: 401,
    });
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, {
      code: "bad_request",
      statusCode: 400,
      details,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, {
      code: "not_found",
      statusCode: 404,
    });
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(method, allowedMethods) {
    super(`${method} is not allowed for this route`, {
      code: "method_not_allowed",
      statusCode: 405,
      details: { allowedMethods },
    });
    this.allowedMethods = allowedMethods;
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(provider) {
    super(`Provider '${provider}' is not available`, {
      code: "provider_unavailable",
      statusCode: 400,
    });
  }
}

export class UpstreamError extends AppError {
  constructor(message, details) {
    super(message, {
      code: "upstream_error",
      statusCode: 502,
      details,
    });
  }
}

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function assertMethod(req, allowedMethods) {
  if (!allowedMethods.includes(req.method)) {
    throw new MethodNotAllowedError(req.method, allowedMethods);
  }
}

export function handleError(res, error) {
  if (error instanceof MethodNotAllowedError) {
    sendJson(
      res,
      error.statusCode,
      { error: error.code, message: error.message, details: error.details },
      { Allow: error.allowedMethods.join(", ") },
    );
    return;
  }

  if (error instanceof AppError) {
    sendJson(res, error.statusCode, {
      error: error.code,
      message: error.message,
      details: error.details,
    });
    return;
  }

  sendJson(res, 500, {
    error: "internal_error",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

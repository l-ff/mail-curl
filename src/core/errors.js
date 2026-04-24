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

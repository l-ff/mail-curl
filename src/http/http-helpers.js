import { AppError, MethodNotAllowedError } from "../core/errors.js";

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

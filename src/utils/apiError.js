/**
 * Standardized Operational API Error class.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} code - Machine-readable error code (e.g., 'NOT_FOUND')
   * @param {string} message - Human-readable explanation
   * @param {Array|Object} [details=[]] - Optional additional error metadata/field errors
   */
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = "BAD_REQUEST", details = []) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED") {
    return new ApiError(401, code, message);
  }

  static forbidden(message = "Access denied", code = "FORBIDDEN") {
    return new ApiError(403, code, message);
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }

  static conflict(message, code = "CONFLICT", details = []) {
    return new ApiError(409, code, message, details);
  }

  static internal(message = "Internal server error", code = "INTERNAL_ERROR") {
    return new ApiError(500, code, message);
  }
}

module.exports = ApiError;

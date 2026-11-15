const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");

/**
 * Centralized error-handling middleware for Express 5.
 * Express identifies error handlers by checking fn.length === 4.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.code || "INTERNAL_ERROR";
  let message = err.message || "An unexpected internal server error occurred";
  let details = err.details || [];

  // Handle Mongoose CastError (invalid ObjectId or type casting failure)
  if (err.name === "CastError") {
    statusCode = 400;
    code = "INVALID_IDENTIFIER";
    message = `Invalid format for field '${err.path}': value '${err.value}' is not a valid identifier`;
  }

  // Handle Mongoose Schema Validation errors
  else if (err.name === "ValidationError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = "Schema validation failed";
    details = Object.values(err.errors || {}).map((item) => ({
      field: item.path,
      message: item.message,
      kind: item.kind,
    }));
  }

  // Handle MongoDB Unique Constraint Violation (E11000 duplicate key)
  else if (err.code === 11000) {
    statusCode = 409;
    code = "DUPLICATE_RESOURCE";
    const duplicateFields = Object.keys(err.keyValue || {});
    message = `A resource with the specified ${duplicateFields.join(", ")} already exists`;
    details = err.keyValue;
  }

  // Handle Zod Validation Error (if thrown directly in route/controller)
  else if (err.name === "ZodError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = "Input validation failed";
    details = err.issues || err.errors;
  }

  // Handle SyntaxError from malformed JSON bodies
  else if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    statusCode = 400;
    code = "MALFORMED_JSON";
    message = "Malformed JSON payload in request body";
  }

  // Log 500-level internal errors
  if (statusCode >= 500) {
    logger.error(`Internal Server Error: ${message}`, {
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      stack: err.stack,
    });
  } else {
    logger.debug(`Client Error (${statusCode} - ${code}): ${message}`, {
      path: req.originalUrl,
      method: req.method,
    });
  }

  const responsePayload = {
    success: false,
    error: {
      code,
      message,
      ...(details && (Array.isArray(details) ? details.length > 0 : Object.keys(details).length > 0) && { details }),
    },
  };

  // Include stack trace only in development
  if (process.env.NODE_ENV === "development") {
    responsePayload.error.stack = err.stack;
  }

  return res.status(statusCode).json(responsePayload);
};

module.exports = errorHandler;

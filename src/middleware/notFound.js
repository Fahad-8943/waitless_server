const ApiError = require("../utils/apiError");

/**
 * Middleware to capture 404 Not Found for unregistered routes.
 */
const notFoundHandler = (req, res, next) => {
  next(
    ApiError.notFound(
      `Cannot find endpoint ${req.method} ${req.originalUrl} on this server`,
      "ROUTE_NOT_FOUND"
    )
  );
};

module.exports = notFoundHandler;

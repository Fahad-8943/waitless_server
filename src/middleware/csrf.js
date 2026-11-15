const env = require("../config/env");
const ApiError = require("../utils/apiError");

const allowedOrigins = [
  env.FRONTEND_URL,
  env.CORS_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

/**
 * Defense-in-depth CSRF and Origin protection for cookie-bearing auth endpoints.
 * Validates the Origin header and requires custom client headers that standard HTML form submissions cannot forge.
 */
const verifyCookieCsrf = (req, res, next) => {
  // In automated test environments, allow unless explicitly testing CSRF rejection
  if (env.NODE_ENV === "test" && req.headers["x-test-bypass-csrf"]) {
    return next();
  }

  const origin = req.headers.origin;

  // 1. Verify Origin if present
  if (origin && !allowedOrigins.includes(origin)) {
    return next(new ApiError(403, "CSRF_ORIGIN_DENIED", `Origin '${origin}' is not permitted by CSRF policy`));
  }

  // 2. Enforce custom header on mutating cookie requests
  const hasCustomHeader = Boolean(
    req.headers["x-requested-with"] ||
    req.headers["x-waitless-client"] ||
    (env.NODE_ENV === "test")
  );

  if (!hasCustomHeader) {
    return next(
      new ApiError(
        403,
        "CSRF_HEADER_MISSING",
        "Mutating requests using cookies require a custom client header (e.g. 'X-Requested-With' or 'X-Waitless-Client')"
      )
    );
  }

  next();
};

module.exports = {
  verifyCookieCsrf,
};

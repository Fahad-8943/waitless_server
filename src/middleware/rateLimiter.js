const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

/**
 * Standard error handler for rate limit exceeded responses.
 */
const rateLimitHandler = (message, code = "TOO_MANY_REQUESTS") => (req, res, next) => {
  next(new ApiError(429, code, message));
};

/**
 * IP-based rate limiter for public registration.
 * 5 attempts per hour per IP.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.NODE_ENV === "test" ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many accounts created from this IP, please try again in an hour", "RATE_LIMIT_REGISTER"),
});

/**
 * IP-based rate limiter for login.
 * 10 attempts per 15 minutes per IP.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many login attempts from this IP, please try again in 15 minutes", "RATE_LIMIT_LOGIN_IP"),
});

/**
 * Account-identifier rate limiter for login.
 * 5 attempts per 15 minutes per identifier (email or phone).
 * Prevents distributed botnets from brute-forcing a single targeted account.
 */
const loginIdentifierLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === "test" ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.body && req.body.identifier ? String(req.body.identifier).toLowerCase().trim() : "unknown";
    return `identifier:${id}`;
  },
  handler: rateLimitHandler("Too many login attempts targeting this account, please try again in 15 minutes", "RATE_LIMIT_LOGIN_ACCOUNT"),
});

/**
 * Rate limiter for token refresh calls.
 * 30 requests per 15 minutes per IP.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler("Too many token refresh requests from this IP", "RATE_LIMIT_REFRESH"),
});

module.exports = {
  registerLimiter,
  loginIpLimiter,
  loginIdentifierLimiter,
  refreshLimiter,
};

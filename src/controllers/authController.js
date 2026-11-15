const authService = require("../services/authService");
const { registerSchema, loginSchema } = require("../validators/authValidators");
const env = require("../config/env");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");

/**
 * Construct secure cookie configuration options based on environment settings.
 */
const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  path: env.COOKIE_PATH,
  ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),
  maxAge: env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
});

/**
 * Handle user registration (Customer role strictly enforced).
 */
const register = async (req, res) => {
  const validated = registerSchema.parse(req.body);

  const result = await authService.registerUser({
    ...validated,
    clientIp: req.ip,
  });

  res.cookie("refreshToken", result.rawRefreshToken, getRefreshCookieOptions());

  return ApiResponse.created(res, "Account registered successfully", {
    user: result.user,
    accessToken: result.accessToken,
  });
};

/**
 * Handle user authentication (email or phone).
 */
const login = async (req, res) => {
  const validated = loginSchema.parse(req.body);

  const result = await authService.loginUser({
    ...validated,
    clientIp: req.ip,
  });

  res.cookie("refreshToken", result.rawRefreshToken, getRefreshCookieOptions());

  return ApiResponse.ok(res, "Authenticated successfully", {
    user: result.user,
    accessToken: result.accessToken,
  });
};

/**
 * Handle atomic refresh-token rotation.
 */
const refresh = async (req, res) => {
  const rawRefreshToken = req.cookies && req.cookies.refreshToken;

  if (!rawRefreshToken) {
    throw ApiError.unauthorized("Refresh token is required in cookie", "COOKIE_TOKEN_MISSING");
  }

  const result = await authService.rotateRefreshToken({
    rawRefreshToken,
    clientIp: req.ip,
  });

  // Only update cookie if a new token was generated (not on duplicate replay within grace period)
  if (result.rawRefreshToken) {
    res.cookie("refreshToken", result.rawRefreshToken, getRefreshCookieOptions());
  }

  return ApiResponse.ok(res, "Access token refreshed successfully", {
    accessToken: result.accessToken,
  });
};

/**
 * Handle single-session logout.
 */
const logout = async (req, res) => {
  const rawRefreshToken = req.cookies && req.cookies.refreshToken;

  if (rawRefreshToken) {
    await authService.logout({
      rawRefreshToken,
      clientIp: req.ip,
    });
  }

  res.clearCookie("refreshToken", getRefreshCookieOptions());

  return ApiResponse.ok(res, "Logged out successfully");
};

/**
 * Handle user-wide global session revocation (all devices).
 */
const logoutAll = async (req, res) => {
  await authService.logoutAll({
    userId: req.user._id,
    clientIp: req.ip,
  });

  res.clearCookie("refreshToken", getRefreshCookieOptions());

  return ApiResponse.ok(res, "All active sessions have been globally revoked");
};

/**
 * Retrieve authenticated user profile.
 */
const getMe = async (req, res) => {
  return ApiResponse.ok(res, "User profile retrieved successfully", {
    user: req.user,
  });
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  getRefreshCookieOptions,
};

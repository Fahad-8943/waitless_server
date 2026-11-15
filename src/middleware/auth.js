const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const ApiError = require("../utils/apiError");

/**
 * Protect middleware: Verifies JWT access token and session version.
 */
const protect = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  if (!token) {
    return next(ApiError.unauthorized("Authentication token is required", "TOKEN_MISSING"));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "waitless-api",
      audience: "waitless-client",
    });

    const user = await User.findById(decoded.sub);
    if (!user) {
      return next(ApiError.unauthorized("User account no longer exists", "USER_NOT_FOUND"));
    }

    if (!user.isActive) {
      return next(ApiError.forbidden("Account is deactivated", "ACCOUNT_DISABLED"));
    }

    // Check if token was issued prior to a session revocation event
    if (decoded.tokenVersion !== user.tokenVersion) {
      return next(
        ApiError.unauthorized(
          "Session has been invalidated. Please log in again.",
          "TOKEN_REVOKED"
        )
      );
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return next(ApiError.unauthorized("Access token has expired", "TOKEN_EXPIRED"));
    }
    if (error.name === "JsonWebTokenError") {
      return next(ApiError.unauthorized("Invalid access token format or signature", "TOKEN_INVALID"));
    }
    return next(error);
  }
};

/**
 * RBAC authorization guard.
 * @param  {...string} roles - Permitted roles (e.g. 'provider', 'admin')
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized("Authentication required", "UNAUTHORIZED"));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Role '${req.user.role}' is not authorized to access this resource`,
          "FORBIDDEN"
        )
      );
    }

    next();
  };
};

module.exports = {
  protect,
  authorize,
};

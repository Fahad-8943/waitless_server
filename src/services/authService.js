const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const env = require("../config/env");
const ApiError = require("../utils/apiError");
const logger = require("../utils/logger");

const BCRYPT_ROUNDS = 12;
const CONCURRENCY_WINDOW_MS = 5000; // 5-second window to distinguish simultaneous network race conditions from token theft

/**
 * Hash raw password with bcrypt.
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
};

/**
 * Compare password with hash.
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Sign strict 15-minute Access Token with required claims.
 */
const signAccessToken = (user) => {
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    tokenVersion: user.tokenVersion,
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    issuer: "waitless-api",
    audience: "waitless-client",
    expiresIn: env.JWT_ACCESS_EXPIRATION,
  });
};

/**
 * Generate cryptographically secure random refresh token.
 */
const generateRefreshTokenString = () => {
  return crypto.randomBytes(40).toString("hex");
};

/**
 * Compute SHA-256 digest of token string for database storage.
 */
const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Execute an operation within a MongoDB transaction if a replica set is active.
 * Handles TransientTransactionError with exponential backoff retries.
 */
const withTransactionRetry = async (workFn, maxRetries = 3) => {
  const isReplicaSet = Boolean(
    mongoose.connection.client &&
    mongoose.connection.client.topology &&
    mongoose.connection.client.topology.description.type !== "Single"
  );

  if (!isReplicaSet) {
    // Standalone single-node development mode fallback
    return await workFn(null);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await workFn(session);
      if (session.inTransaction()) {
        await session.commitTransaction();
      }
      return result;
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      const isTransient = err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError");
      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
};

/**
 * Public customer registration service.
 * Enforces role: 'customer' regardless of payload.
 */
const registerUser = async ({ name, email, phone, password, clientIp }) => {
  const cleanEmail = email && email.trim() ? email.toLowerCase().trim() : null;
  const cleanPhone = phone && phone.trim() ? phone.trim() : null;

  // Pre-validate unique constraints with descriptive errors
  if (cleanEmail) {
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      throw ApiError.conflict(`An account with email '${cleanEmail}' already exists`, "EMAIL_EXISTS");
    }
  }

  if (cleanPhone) {
    const existingPhone = await User.findOne({ phone: cleanPhone });
    if (existingPhone) {
      throw ApiError.conflict(`An account with phone number '${cleanPhone}' already exists`, "PHONE_EXISTS");
    }
  }

  const passwordHash = await hashPassword(password);

  // Strictly enforce role: 'customer'
  const user = await User.create({
    name: name.trim(),
    email: cleanEmail,
    phone: cleanPhone,
    passwordHash,
    role: "customer",
    tokenVersion: 0,
    isEmailVerified: false,
    isPhoneVerified: false,
    isActive: true,
  });

  // Issue initial session
  const familyId = crypto.randomUUID();
  const rawRefreshToken = generateRefreshTokenString();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    tokenHash,
    userId: user._id,
    familyId,
    expiresAt,
    isRevoked: false,
    createdByIp: clientIp,
  });

  const accessToken = signAccessToken(user);

  return {
    user: user.toJSON(),
    accessToken,
    rawRefreshToken,
  };
};

/**
 * Authenticate customer or provider via email/phone and password.
 */
const loginUser = async ({ identifier, password, clientIp }) => {
  const cleanId = identifier.trim();
  const isEmail = cleanId.includes("@");

  const query = isEmail ? { email: cleanId.toLowerCase() } : { phone: cleanId };

  const user = await User.findOne(query).select("+passwordHash");
  if (!user) {
    throw ApiError.unauthorized("Invalid credentials provided", "INVALID_CREDENTIALS");
  }

  if (!user.isActive) {
    throw ApiError.forbidden("Account is deactivated. Please contact support.", "ACCOUNT_DISABLED");
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash);
  if (!isPasswordValid) {
    throw ApiError.unauthorized("Invalid credentials provided", "INVALID_CREDENTIALS");
  }

  // Generate new session family
  const familyId = crypto.randomUUID();
  const rawRefreshToken = generateRefreshTokenString();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    tokenHash,
    userId: user._id,
    familyId,
    expiresAt,
    isRevoked: false,
    createdByIp: clientIp,
  });

  const accessToken = signAccessToken(user);

  return {
    user: user.toJSON(),
    accessToken,
    rawRefreshToken,
  };
};

/**
 * Rotate refresh token with conditional atomic updates and replay grace period.
 */
const rotateRefreshToken = async ({ rawRefreshToken, clientIp }) => {
  const incomingHash = hashToken(rawRefreshToken);
  const nextRawRefreshToken = generateRefreshTokenString();
  const nextTokenHash = hashToken(nextRawRefreshToken);
  const nextExpiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  const rotationResult = await withTransactionRetry(async (session) => {
    // 1. Conditional atomic update: Only an active, unrevoked, non-expired token matches
    const oldToken = await RefreshToken.findOneAndUpdate(
      {
        tokenHash: incomingHash,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          isRevoked: true,
          revokedAt: new Date(),
          replacedByTokenHash: nextTokenHash,
          revokedByIp: clientIp,
          revocationReason: "ROTATED",
        },
      },
      { returnDocument: "before", ...(session && { session }) }
    );

    if (oldToken) {
      // WINNING REQUEST: Successfully rotated
      const user = await User.findById(oldToken.userId).session(session || null);
      if (!user || !user.isActive) {
        throw ApiError.unauthorized("User account is inactive or no longer exists", "ACCOUNT_INACTIVE");
      }

      await RefreshToken.create(
        [
          {
            tokenHash: nextTokenHash,
            userId: oldToken.userId,
            familyId: oldToken.familyId,
            expiresAt: nextExpiresAt,
            isRevoked: false,
            createdByIp: clientIp,
          },
        ],
        { ...(session && { session }) }
      );

      const accessToken = signAccessToken(user);
      return {
        accessToken,
        rawRefreshToken: nextRawRefreshToken,
      };
    }

    // 2. Token did not match active criteria: inspect database for specific reason
    const existing = await RefreshToken.findOne({ tokenHash: incomingHash }).session(session || null);

    if (!existing) {
      throw ApiError.unauthorized("Invalid refresh token", "INVALID_REFRESH_TOKEN");
    }

    if (existing.expiresAt <= new Date()) {
      throw ApiError.unauthorized("Refresh token has expired", "EXPIRED_REFRESH_TOKEN");
    }

    // 3. Token is already revoked. Check for concurrent race condition vs confirmed token reuse
    if (existing.isRevoked) {
      const nowMs = Date.now();
      const revokedAtMs = existing.revokedAt ? new Date(existing.revokedAt).getTime() : 0;
      const isWithinConcurrencyWindow = (nowMs - revokedAtMs) <= CONCURRENCY_WINDOW_MS;

      // Concurrent request that lost the rotation race: issue NO credentials and trigger NO theft alarm
      if (isWithinConcurrencyWindow && existing.revocationReason === "ROTATED") {
        logger.warn("Concurrent refresh race condition detected; losing request rejected safely with zero credentials issued", {
          userId: existing.userId,
          familyId: existing.familyId,
          ip: clientIp,
        });
        throw ApiError.conflict(
          "A concurrent refresh request has already rotated this session token. Please use your latest credentials.",
          "CONCURRENT_REFRESH_RACE"
        );
      }

      // If token was revoked for a reason other than rotation (e.g. standard logout)
      if (existing.revocationReason !== "ROTATED") {
        throw ApiError.unauthorized("Session has already been revoked or logged out", "SESSION_REVOKED");
      }

      // CONFIRMED TOKEN REUSE (Theft presentation of a previously rotated token outside concurrency window)
      logger.warn(`SECURITY ALERT: Confirmed refresh token reuse detected for user ${existing.userId}! Triggering user-wide global session revocation.`, {
        userId: existing.userId,
        familyId: existing.familyId,
        ip: clientIp,
      });

      // Revoke ALL active tokens across ALL families for this user
      await RefreshToken.updateMany(
        { userId: existing.userId, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            revokedAt: new Date(),
            revokedByIp: clientIp,
            revocationReason: "THEFT_DETECTED",
          },
        },
        { ...(session && { session }) }
      );

      // Increment tokenVersion to immediately invalidate all active access tokens
      await User.findByIdAndUpdate(
        existing.userId,
        { $inc: { tokenVersion: 1 } },
        { ...(session && { session }) }
      );

      // Commit the global revocation writes permanently before returning the 401 error
      if (session && session.inTransaction()) {
        await session.commitTransaction();
      }

      throw ApiError.unauthorized(
        "Compromised refresh token reuse detected. All active sessions have been globally revoked.",
        "REVOKED_TOKEN_REUSE"
      );
    }

    throw ApiError.unauthorized("Unable to refresh session", "REFRESH_FAILED");
  });

  return rotationResult;
};

/**
 * Logout single session by revoking its token family.
 */
const logout = async ({ rawRefreshToken, clientIp }) => {
  if (!rawRefreshToken) return;

  const tokenHash = hashToken(rawRefreshToken);
  const token = await RefreshToken.findOne({ tokenHash });

  if (token) {
    await RefreshToken.updateMany(
      { familyId: token.familyId, isRevoked: false },
      {
        $set: {
          isRevoked: true,
          revokedAt: new Date(),
          revokedByIp: clientIp,
          revocationReason: "LOGOUT",
        },
      }
    );
  }
};

/**
 * Global session revocation: Logs out all devices for a user.
 */
const logoutAll = async ({ userId, clientIp }) => {
  // Revoke all active refresh tokens across every family
  await RefreshToken.updateMany(
    { userId, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedByIp: clientIp,
        revocationReason: "LOGOUT_ALL",
      },
    }
  );

  // Bump tokenVersion to invalidate all active access tokens
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
};

module.exports = {
  hashPassword,
  comparePassword,
  signAccessToken,
  generateRefreshTokenString,
  hashToken,
  registerUser,
  loginUser,
  rotateRefreshToken,
  logout,
  logoutAll,
};

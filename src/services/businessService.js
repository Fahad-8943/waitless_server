const Business = require("../models/Business");
const User = require("../models/User");
const { withTransactionRetry } = require("../utils/transaction");
const { signAccessToken } = require("./authService");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

/**
 * Register a new business venue atomically inside a MongoDB transaction.
 *
 * Transaction Workflow:
 * 1. Inside transaction:
 *    a. If user.role === 'customer', conditionally elevate role to 'provider' and increment tokenVersion + 1.
 *    b. Insert Business document (ownerId = user._id, approvalStatus = env.DEFAULT_BUSINESS_APPROVAL_STATUS).
 * 2. Commit transaction.
 * 3. ONLY after successful commit, issue a fresh access token (if elevated) with role: 'provider'
 *    and the updated tokenVersion, invalidating the old customer access token.
 * 4. Return { business, accessToken }.
 */
const registerBusiness = async (user, payload) => {
  let roleElevated = false;
  let updatedUser = user;

  const result = await withTransactionRetry(async (session) => {
    // 1. Conditional atomic role elevation from 'customer' to 'provider'
    // Matches role: 'customer' conditionally to prevent redundant tokenVersion increments under concurrency.
    const elevated = await User.findOneAndUpdate(
      { _id: user._id, role: "customer" },
      {
        $set: { role: "provider" },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: "after", session }
    );

    if (elevated) {
      updatedUser = elevated;
      roleElevated = true;
    } else {
      // User is already a provider/admin or was elevated concurrently
      const currentUser = await User.findById(user._id).session(session);
      if (!currentUser) {
        throw ApiError.notFound("User account not found", "USER_NOT_FOUND");
      }
      updatedUser = currentUser;
      roleElevated = false;
    }

    // 2. Insert Business document
    const businessData = {
      name: payload.name,
      category: payload.category,
      description: payload.description || "",
      contact: payload.contact || {
        email: updatedUser.email || null,
        phone: updatedUser.phone || null,
      },
      address: payload.address,
      location: {
        type: "Point",
        coordinates: payload.location.coordinates,
      },
      timezone: payload.timezone || "Asia/Kolkata",
      operatingHours: payload.operatingHours || [],
      specialClosures: payload.specialClosures || [],
      policies: payload.policies || {},
      ownerId: updatedUser._id,
      approvalStatus: env.DEFAULT_BUSINESS_APPROVAL_STATUS,
      isActive: true,
    };

    const [business] = await Business.create([businessData], { session });

    return { business };
  });

  // 3. Issue fresh access token ONLY after successful transaction commit
  let newAccessToken = null;
  if (roleElevated) {
    newAccessToken = signAccessToken(updatedUser);
  }

  return {
    business: result.business,
    accessToken: newAccessToken,
  };
};

/**
 * Get all businesses owned by the authenticated user.
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<Array<Business>>}
 */
const getMyBusinesses = async (userId) => {
  return await Business.find({ ownerId: userId, isActive: true }).sort({ createdAt: -1 });
};

module.exports = {
  registerBusiness,
  getMyBusinesses,
};

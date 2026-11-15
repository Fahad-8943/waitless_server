const User = require("../models/User");
const ApiError = require("../utils/apiError");

/**
 * Retrieve user profile by user ID.
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<Object>} Safe user object without password hash
 */
const getUserProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.notFound("User account not found", "USER_NOT_FOUND");
  }

  return user.toJSON();
};

/**
 * Update permitted customer/user profile fields.
 * Strictly prevents role escalation, password alteration, or session tampering.
 *
 * @param {string|ObjectId} userId
 * @param {Object} payload - Validated update fields (name, email, phone)
 * @returns {Promise<Object>} Updated safe user object
 */
const updateUserProfile = async (userId, payload) => {
  // Check email conflict
  if (payload.email) {
    const existingEmail = await User.findOne({
      email: payload.email,
      _id: { $ne: userId },
    });
    if (existingEmail) {
      throw ApiError.conflict(
        `An account with email '${payload.email}' already exists`,
        "EMAIL_EXISTS"
      );
    }
  }

  // Check phone conflict
  if (payload.phone) {
    const existingPhone = await User.findOne({
      phone: payload.phone,
      _id: { $ne: userId },
    });
    if (existingPhone) {
      throw ApiError.conflict(
        `An account with phone number '${payload.phone}' already exists`,
        "PHONE_EXISTS"
      );
    }
  }

  const updateOps = {};
  if (payload.name !== undefined) updateOps.name = payload.name;
  if (payload.email !== undefined) updateOps.email = payload.email;
  if (payload.phone !== undefined) updateOps.phone = payload.phone;

  if (Object.keys(updateOps).length === 0) {
    return await getUserProfile(userId);
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateOps },
    { returnDocument: "after", runValidators: true }
  );

  if (!updatedUser) {
    throw ApiError.notFound("User account not found", "USER_NOT_FOUND");
  }

  return updatedUser.toJSON();
};

module.exports = {
  getUserProfile,
  updateUserProfile,
};

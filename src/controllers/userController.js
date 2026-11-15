const userService = require("../services/userService");
const { updateUserProfileSchema } = require("../validators/userValidators");
const ApiResponse = require("../utils/apiResponse");

/**
 * Retrieve authenticated user profile.
 */
const getProfile = async (req, res) => {
  const user = await userService.getUserProfile(req.user._id);

  return ApiResponse.ok(res, "Profile retrieved successfully", {
    user,
  });
};

/**
 * Update authenticated user profile.
 */
const updateProfile = async (req, res) => {
  const validated = updateUserProfileSchema.parse(req.body);
  const updatedUser = await userService.updateUserProfile(req.user._id, validated);

  return ApiResponse.ok(res, "Profile updated successfully", {
    user: updatedUser,
  });
};

module.exports = {
  getProfile,
  updateProfile,
};

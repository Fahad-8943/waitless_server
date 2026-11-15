const businessService = require("../services/businessService");
const { registerBusinessSchema } = require("../validators/businessValidators");
const ApiResponse = require("../utils/apiResponse");

/**
 * Handle new business registration.
 * Transactionally creates Business with ownerId and elevates customer to provider.
 */
const registerBusiness = async (req, res) => {
  const validated = registerBusinessSchema.parse(req.body);

  const result = await businessService.registerBusiness(req.user, validated);

  return ApiResponse.created(res, "Business venue registered successfully", {
    business: result.business,
    accessToken: result.accessToken,
  });
};

/**
 * List all businesses owned by the authenticated provider or administrator.
 */
const getMyBusinesses = async (req, res) => {
  const businesses = await businessService.getMyBusinesses(req.user._id);

  return ApiResponse.ok(res, "Businesses retrieved successfully", {
    businesses,
  });
};

/**
 * Scoped access verification handler.
 * Used to verify direct business ownership and administrator oversight.
 */
const verifyAccess = async (req, res) => {
  return ApiResponse.ok(res, "Access granted to business venue", {
    business: {
      _id: req.business._id,
      name: req.business.name,
      ownerId: req.business.ownerId,
      approvalStatus: req.business.approvalStatus,
      isActive: req.business.isActive,
    },
    isPlatformAdmin: req.isPlatformAdmin,
  });
};

module.exports = {
  registerBusiness,
  getMyBusinesses,
  verifyAccess,
};

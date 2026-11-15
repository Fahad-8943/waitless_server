const businessService = require("../services/businessService");
const { registerBusinessSchema } = require("../validators/businessValidators");
const ApiResponse = require("../utils/apiResponse");

/**
 * Handle new business registration.
 * Transactionally elevates customer to provider and creates owner staff membership.
 */
const registerBusiness = async (req, res) => {
  const validated = registerBusinessSchema.parse(req.body);

  const result = await businessService.registerBusiness(req.user, validated);

  return ApiResponse.created(res, "Business venue registered successfully", {
    business: result.business,
    staff: result.staff,
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
 * Used to verify tenant authorization and membership boundaries.
 */
const verifyAccess = async (req, res) => {
  return ApiResponse.ok(res, "Access granted to business venue", {
    business: {
      _id: req.business._id,
      name: req.business.name,
      approvalStatus: req.business.approvalStatus,
      isActive: req.business.isActive,
    },
    staff: req.staffMembership,
    isPlatformAdmin: req.isPlatformAdmin,
  });
};

module.exports = {
  registerBusiness,
  getMyBusinesses,
  verifyAccess,
};

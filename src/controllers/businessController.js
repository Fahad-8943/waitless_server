const mongoose = require("mongoose");
const businessService = require("../services/businessService");
const {
  registerBusinessSchema,
  updateBusinessProfileSchema,
} = require("../validators/businessValidators");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");

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
 * Retrieve one business profile for the owner or platform admin.
 */
const getBusinessProfile = async (req, res) => {
  return ApiResponse.ok(res, "Business profile retrieved successfully", {
    business: req.business,
    isPlatformAdmin: req.isPlatformAdmin,
  });
};

/**
 * Update business profile details.
 * Restricted strictly to the direct business owner; platform admins are view-only.
 */
const updateBusinessProfile = async (req, res) => {
  // Platform admins are strictly view-only for business profile updates
  if (req.isPlatformAdmin || req.user.role === "admin") {
    throw ApiError.forbidden(
      "Platform administrators are view-only and cannot update business profiles",
      "ADMIN_UPDATE_FORBIDDEN"
    );
  }

  const validated = updateBusinessProfileSchema.parse(req.body);
  const updatedBusiness = await businessService.updateBusinessProfile(
    req.business._id,
    validated
  );

  return ApiResponse.ok(res, "Business profile updated successfully", {
    business: updatedBusiness,
  });
};

/**
 * List approved and active businesses for public discovery.
 */
const getPublicBusinesses = async (req, res) => {
  const result = await businessService.getPublicBusinesses(req.query);

  return ApiResponse.ok(res, "Public businesses retrieved successfully", {
    businesses: result.businesses,
    pagination: result.pagination,
  });
};

/**
 * Retrieve sanitized public business profile.
 * Only returns venues that are approved and active.
 */
const getPublicBusinessProfile = async (req, res) => {
  const { businessId } = req.params;

  if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  const publicProfile = await businessService.getPublicBusinessProfile(businessId);

  return ApiResponse.ok(res, "Public business profile retrieved successfully", {
    business: publicProfile,
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
  getBusinessProfile,
  updateBusinessProfile,
  getPublicBusinesses,
  getPublicBusinessProfile,
  verifyAccess,
};

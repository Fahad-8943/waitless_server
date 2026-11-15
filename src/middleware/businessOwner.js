const mongoose = require("mongoose");
const Business = require("../models/Business");
const ApiError = require("../utils/apiError");

/**
 * Middleware: requireBusinessOwner
 *
 * Enforces business ownership authorization:
 * 1. Validates businessId from req.params.businessId, req.params.id, or req.body.businessId.
 * 2. Explicit Platform Admin Authorization:
 *    If user has global role 'admin', validates that the business exists and grants access,
 *    attaching req.isPlatformAdmin = true.
 * 3. Business Status:
 *    Verifies that the business exists, is active, and is not suspended.
 * 4. Direct Ownership:
 *    Verifies that Business.ownerId matches req.user._id directly.
 *    If mismatched, rejects with 403 FORBIDDEN_BUSINESS_ACCESS (prevents cross-business IDOR).
 * 5. Attaches req.business and req.isPlatformAdmin.
 */
const requireBusinessOwner = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.params.id || req.body.businessId;

    if (!businessId) {
      return next(
        ApiError.badRequest("Business ID is required in request", "BUSINESS_ID_REQUIRED")
      );
    }

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return next(
        ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID")
      );
    }

    if (!req.user) {
      return next(ApiError.unauthorized("Authentication required", "AUTH_REQUIRED"));
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return next(ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND"));
    }

    // Explicit Platform Admin Authorization
    if (req.user.role === "admin") {
      req.business = business;
      req.isPlatformAdmin = true;
      return next();
    }

    // Inactive business protection
    if (!business.isActive) {
      return next(
        ApiError.forbidden("Business venue is deactivated", "BUSINESS_DEACTIVATED")
      );
    }

    // Suspended business protection (blocks non-admin access)
    if (business.approvalStatus === "suspended") {
      return next(
        ApiError.forbidden("Business venue is suspended", "BUSINESS_SUSPENDED")
      );
    }

    // Direct ownership check
    if (business.ownerId.toString() !== req.user._id.toString()) {
      return next(
        ApiError.forbidden(
          "Access denied: You do not own this business venue",
          "FORBIDDEN_BUSINESS_ACCESS"
        )
      );
    }

    req.business = business;
    req.isPlatformAdmin = false;

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireBusinessOwner,
};

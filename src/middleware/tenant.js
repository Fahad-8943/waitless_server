const mongoose = require("mongoose");
const Business = require("../models/Business");
const Staff = require("../models/Staff");
const ApiError = require("../utils/apiError");

/**
 * Explicit Business Permission Matrix:
 * Maps business operations to authorized staff roles.
 */
const PERMISSION_ROLES = {
  MANAGE_BUSINESS: ["owner"],
  TRANSFER_OWNERSHIP: ["owner"],
  MANAGE_STAFF: ["owner"],
  MANAGE_SERVICES: ["owner", "manager"],
  MANAGE_COUNTERS: ["owner", "manager"],
  ASSIGN_COUNTERS: ["owner", "manager", "staff"],
  VIEW_INTERNAL: ["owner", "manager", "staff"],
};

/**
 * Middleware: requireBusinessPermission(permission)
 *
 * Enforces business-scoped authorization and multi-tenant isolation:
 * 1. Validates businessId from req.params.businessId, req.params.id, or req.body.businessId.
 * 2. Explicit Platform Admin Authorization:
 *    If user has global role 'admin', validates that the business exists and grants access,
 *    attaching req.isPlatformAdmin = true.
 * 3. Standard Business Scoping:
 *    Verifies that the business exists and is active.
 *    Verifies that the business is not suspended (blocks non-admin access).
 *    Queries the Staff collection for an active membership matching (businessId, req.user._id).
 *    If no membership is found, rejects with 403 FORBIDDEN_BUSINESS_ACCESS (prevents cross-business IDOR).
 *    Checks if the member's role is permitted for the requested operation.
 * 4. Attaches req.business, req.staffMembership, and req.isPlatformAdmin.
 */
const requireBusinessPermission = (permission) => {
  return async (req, res, next) => {
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
        req.staffMembership = null;
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

      // Scoped tenant membership lookup
      const staff = await Staff.findOne({
        businessId: business._id,
        userId: req.user._id,
        isActive: true,
      });

      if (!staff) {
        return next(
          ApiError.forbidden(
            "Access denied: You are not an active member of this business venue",
            "FORBIDDEN_BUSINESS_ACCESS"
          )
        );
      }

      const allowedRoles = PERMISSION_ROLES[permission];
      if (!allowedRoles || !allowedRoles.includes(staff.role)) {
        return next(
          ApiError.forbidden(
            `Access denied: Operation requires ${permission} permission`,
            "FORBIDDEN_ACTION"
          )
        );
      }

      // Attach context to request
      req.business = business;
      req.staffMembership = staff;
      req.isPlatformAdmin = false;

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware: requireBusinessMembership
 *
 * Ensures the authenticated user is an active member of the business
 * with any recognized role ('owner', 'manager', 'staff') or platform admin.
 */
const requireBusinessMembership = requireBusinessPermission("VIEW_INTERNAL");

module.exports = {
  PERMISSION_ROLES,
  requireBusinessPermission,
  requireBusinessMembership,
};

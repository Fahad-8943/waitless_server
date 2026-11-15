const adminService = require("../services/adminService");
const ApiResponse = require("../utils/apiResponse");
const {
  updateUserStatusSchema,
  adminReasonSchema,
  adminUserQuerySchema,
  adminBusinessQuerySchema,
} = require("../validators/adminValidators");

/**
 * Retrieve platform-wide aggregate statistics.
 */
const getPlatformStats = async (req, res, next) => {
  try {
    const stats = await adminService.getPlatformStats();
    return ApiResponse.ok(res, "Platform statistics retrieved successfully", stats);
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve paginated list of users with search and filter capabilities.
 */
const listUsers = async (req, res, next) => {
  try {
    const validatedQuery = adminUserQuerySchema.parse(req.query);
    const result = await adminService.listUsers(validatedQuery);
    return ApiResponse.ok(
      res,
      "Users retrieved successfully",
      result.users,
      result.pagination
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve paginated list of businesses with search and lifecycle filters.
 */
const listBusinesses = async (req, res, next) => {
  try {
    const validatedQuery = adminBusinessQuerySchema.parse(req.query);
    const result = await adminService.listBusinesses(validatedQuery);
    return ApiResponse.ok(
      res,
      "Businesses retrieved successfully",
      result.businesses,
      result.pagination
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Platform Admin approves a business venue.
 */
const approveBusiness = async (req, res, next) => {
  try {
    const business = await adminService.approveBusiness(req.params.businessId);
    return ApiResponse.ok(res, "Business approved successfully", business);
  } catch (error) {
    next(error);
  }
};

/**
 * Platform Admin rejects a business venue.
 */
const rejectBusiness = async (req, res, next) => {
  try {
    const validatedBody = adminReasonSchema.parse(req.body || {});
    const business = await adminService.rejectBusiness(
      req.params.businessId,
      validatedBody.reason
    );
    return ApiResponse.ok(res, "Business rejected successfully", business);
  } catch (error) {
    next(error);
  }
};

/**
 * Platform Admin suspends a business venue.
 */
const suspendBusiness = async (req, res, next) => {
  try {
    const validatedBody = adminReasonSchema.parse(req.body || {});
    const business = await adminService.suspendBusiness(
      req.params.businessId,
      validatedBody.reason
    );
    return ApiResponse.ok(res, "Business suspended successfully", business);
  } catch (error) {
    next(error);
  }
};

/**
 * Platform Admin reactivates a suspended business venue.
 */
const reactivateBusiness = async (req, res, next) => {
  try {
    const business = await adminService.reactivateBusiness(req.params.businessId);
    return ApiResponse.ok(res, "Business reactivated successfully", business);
  } catch (error) {
    next(error);
  }
};

/**
 * Platform Admin activates or deactivates a user account.
 */
const updateUserStatus = async (req, res, next) => {
  try {
    const validatedBody = updateUserStatusSchema.parse(req.body);
    const user = await adminService.updateUserStatus(
      req.params.userId,
      validatedBody.isActive,
      req.user._id
    );
    const message = validatedBody.isActive
      ? "User account activated successfully"
      : "User account deactivated successfully";
    return ApiResponse.ok(res, message, user);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlatformStats,
  listUsers,
  listBusinesses,
  approveBusiness,
  rejectBusiness,
  suspendBusiness,
  reactivateBusiness,
  updateUserStatus,
};

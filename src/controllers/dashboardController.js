const dashboardService = require("../services/dashboardService");
const ApiResponse = require("../utils/apiResponse");

/**
 * Provider retrieves dashboard analytics for a specific owned business.
 */
const getBusinessDashboard = async (req, res, next) => {
  try {
    const dashboard = await dashboardService.getBusinessDashboard(req.params.businessId);
    return ApiResponse.ok(
      res,
      "Business dashboard statistics retrieved successfully",
      dashboard
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Provider retrieves aggregate overview across all businesses they own.
 */
const getProviderOverview = async (req, res, next) => {
  try {
    const overview = await dashboardService.getProviderOverview(req.user._id);
    return ApiResponse.ok(
      res,
      "Provider overview statistics retrieved successfully",
      overview
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBusinessDashboard,
  getProviderOverview,
};

const express = require("express");
const businessController = require("../../controllers/businessController");
const { protect, authorize } = require("../../middleware/auth");
const {
  requireBusinessPermission,
  requireBusinessMembership,
} = require("../../middleware/tenant");

const router = express.Router();

// Business Onboarding (Any authenticated user can register a business)
router.post("/register", protect, businessController.registerBusiness);

// My Businesses (Restricted to Providers and Platform Admins)
router.get("/my/list", protect, authorize("provider", "admin"), businessController.getMyBusinesses);

// Scoped Tenant Permission Endpoints (For tenant verification and authorization testing)
router.get(
  "/:businessId/verify-access",
  protect,
  requireBusinessMembership,
  businessController.verifyAccess
);

router.get(
  "/:businessId/manage-permission",
  protect,
  requireBusinessPermission("MANAGE_BUSINESS"),
  businessController.verifyAccess
);

router.get(
  "/:businessId/staff-permission",
  protect,
  requireBusinessPermission("MANAGE_STAFF"),
  businessController.verifyAccess
);

router.get(
  "/:businessId/services-permission",
  protect,
  requireBusinessPermission("MANAGE_SERVICES"),
  businessController.verifyAccess
);

module.exports = router;

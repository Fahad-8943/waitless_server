const express = require("express");
const businessController = require("../../controllers/businessController");
const { protect, authorize } = require("../../middleware/auth");
const { requireBusinessOwner } = require("../../middleware/businessOwner");

const router = express.Router();

// Business Onboarding (Any authenticated user can register a business)
router.post("/register", protect, businessController.registerBusiness);

// My Businesses (Restricted to Providers and Platform Admins)
router.get("/my/list", protect, authorize("provider", "admin"), businessController.getMyBusinesses);

// Scoped Business Access Verification (Direct Business Owner or Platform Admin)
router.get(
  "/:businessId/verify-access",
  protect,
  requireBusinessOwner,
  businessController.verifyAccess
);

module.exports = router;

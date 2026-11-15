const express = require("express");
const businessController = require("../../controllers/businessController");
const { protect, authorize } = require("../../middleware/auth");
const { requireBusinessOwner } = require("../../middleware/businessOwner");

const router = express.Router();

// 1. Public Business Profile (No auth required, approved & active venues only)
router.get("/public/:businessId", businessController.getPublicBusinessProfile);

// 2. Business Onboarding (Any authenticated user can register a business)
router.post("/register", protect, businessController.registerBusiness);

// 3. My Businesses (Restricted to Providers and Platform Admins)
router.get("/my/list", protect, authorize("provider", "admin"), businessController.getMyBusinesses);

// 4. Owner / Admin Business Profile Retrieval (Direct Business Owner or Platform Admin)
router.get(
  "/:businessId",
  protect,
  requireBusinessOwner,
  businessController.getBusinessProfile
);

// 5. Owner Business Profile Update (Direct Business Owner only; Platform Admins forbidden)
router.patch(
  "/:businessId",
  protect,
  requireBusinessOwner,
  businessController.updateBusinessProfile
);

// 6. Scoped Business Access Verification (Direct Business Owner or Platform Admin)
router.get(
  "/:businessId/verify-access",
  protect,
  requireBusinessOwner,
  businessController.verifyAccess
);

module.exports = router;

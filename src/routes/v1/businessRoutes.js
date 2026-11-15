const express = require("express");
const businessController = require("../../controllers/businessController");
const serviceController = require("../../controllers/serviceController");
const bookingController = require("../../controllers/bookingController");
const queueController = require("../../controllers/queueController");
const dashboardController = require("../../controllers/dashboardController");
const { protect, authorize } = require("../../middleware/auth");
const { requireBusinessOwner } = require("../../middleware/businessOwner");

const router = express.Router();

// 1. Public Discovery Endpoints (No auth required, approved & active venues only)
router.get("/public", businessController.getPublicBusinesses);
router.get("/public/:businessId", businessController.getPublicBusinessProfile);
router.get("/public/:businessId/services", serviceController.getPublicServices);

// 2. Business Onboarding (Any authenticated user can register a business)
router.post("/register", protect, businessController.registerBusiness);

// 3. My Businesses & Provider Overview (Restricted to Providers and Platform Admins)
router.get("/my/list", protect, authorize("provider", "admin"), businessController.getMyBusinesses);
router.get("/my/dashboard", protect, authorize("provider", "admin"), dashboardController.getProviderOverview);

// 4. Per-Business Provider Dashboard (Direct Business Owner or Platform Admin)
router.get(
  "/:businessId/dashboard",
  protect,
  requireBusinessOwner,
  dashboardController.getBusinessDashboard
);

// 5. Owner / Admin Business Profile Retrieval (Direct Business Owner or Platform Admin)
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

// 7. Business Service Management (Guarded by requireBusinessOwner)
router.post(
  "/:businessId/services",
  protect,
  requireBusinessOwner,
  serviceController.createService
);

router.get(
  "/:businessId/services",
  protect,
  requireBusinessOwner,
  serviceController.getBusinessServices
);

router.get(
  "/:businessId/services/:serviceId",
  protect,
  requireBusinessOwner,
  serviceController.getServiceDetails
);

router.patch(
  "/:businessId/services/:serviceId",
  protect,
  requireBusinessOwner,
  serviceController.updateService
);

// 8. Business Booking Management (Guarded by requireBusinessOwner)
router.get(
  "/:businessId/bookings",
  protect,
  requireBusinessOwner,
  bookingController.getBusinessBookings
);

router.patch(
  "/:businessId/bookings/:bookingId/confirm",
  protect,
  requireBusinessOwner,
  bookingController.confirmBooking
);

router.patch(
  "/:businessId/bookings/:bookingId/reject",
  protect,
  requireBusinessOwner,
  bookingController.rejectBooking
);

router.patch(
  "/:businessId/bookings/:bookingId/complete",
  protect,
  requireBusinessOwner,
  bookingController.completeBooking
);

router.patch(
  "/:businessId/bookings/:bookingId/cancel",
  protect,
  requireBusinessOwner,
  bookingController.cancelProviderBooking
);

// 9. Business Walk-in Queue Management (Guarded by requireBusinessOwner)
router.get(
  "/:businessId/queue",
  protect,
  requireBusinessOwner,
  queueController.getBusinessQueue
);

router.post(
  "/:businessId/queue/call-next",
  protect,
  requireBusinessOwner,
  queueController.callNextCustomer
);

router.patch(
  "/:businessId/queue/:queueEntryId/call",
  protect,
  requireBusinessOwner,
  queueController.callSpecificCustomer
);

router.patch(
  "/:businessId/queue/:queueEntryId/complete",
  protect,
  requireBusinessOwner,
  queueController.completeQueueEntry
);

router.patch(
  "/:businessId/queue/:queueEntryId/skip",
  protect,
  requireBusinessOwner,
  queueController.skipQueueEntry
);

module.exports = router;

const express = require("express");
const adminController = require("../../controllers/adminController");
const { protect, authorize } = require("../../middleware/auth");

const router = express.Router();

// Enforce strict Platform Admin authentication and authorization across all routes
router.use(protect, authorize("admin"));

// 1. Platform Statistics
router.get("/stats", adminController.getPlatformStats);

// 2. User Management
router.get("/users", adminController.listUsers);
router.patch("/users/:userId/status", adminController.updateUserStatus);

// 3. Business Moderation and Lifecycle
router.get("/businesses", adminController.listBusinesses);
router.patch("/businesses/:businessId/approve", adminController.approveBusiness);
router.patch("/businesses/:businessId/reject", adminController.rejectBusiness);
router.patch("/businesses/:businessId/suspend", adminController.suspendBusiness);
router.patch("/businesses/:businessId/reactivate", adminController.reactivateBusiness);

module.exports = router;

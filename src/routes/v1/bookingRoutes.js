const express = require("express");
const bookingController = require("../../controllers/bookingController");
const { protect } = require("../../middleware/auth");

const router = express.Router();

// 1. Customer booking management
router.post("/", protect, bookingController.createBooking);
router.get("/my", protect, bookingController.getCustomerBookings);
router.get("/", protect, bookingController.getCustomerBookings);
router.get("/:bookingId", protect, bookingController.getBookingById);
router.patch("/:bookingId/cancel", protect, bookingController.cancelCustomerBooking);

module.exports = router;

const express = require("express");
const healthRoutes = require("./healthRoutes");
const authRoutes = require("./authRoutes");
const businessRoutes = require("./businessRoutes");
const userRoutes = require("./userRoutes");
const bookingRoutes = require("./bookingRoutes");
const queueRoutes = require("./queueRoutes");
const adminRoutes = require("./adminRoutes");

const router = express.Router();

// Mount API domain routes
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/businesses", businessRoutes);
router.use("/users", userRoutes);
router.use("/bookings", bookingRoutes);
router.use("/queues", queueRoutes);
router.use("/admin", adminRoutes);

module.exports = router;

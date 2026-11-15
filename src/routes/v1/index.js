const express = require("express");
const healthRoutes = require("./healthRoutes");
const authRoutes = require("./authRoutes");

const router = express.Router();

// Mount API domain routes
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);

module.exports = router;

const express = require("express");
const userController = require("../../controllers/userController");
const { protect } = require("../../middleware/auth");

const router = express.Router();

// Customer / User Profile Management
router.get("/profile", protect, userController.getProfile);
router.patch("/profile", protect, userController.updateProfile);

// Aliases for convenience
router.get("/me", protect, userController.getProfile);
router.patch("/me", protect, userController.updateProfile);

module.exports = router;

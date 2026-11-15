const express = require("express");
const authController = require("../../controllers/authController");
const userController = require("../../controllers/userController");
const { protect } = require("../../middleware/auth");
const { verifyCookieCsrf } = require("../../middleware/csrf");
const {
  registerLimiter,
  loginIpLimiter,
  loginIdentifierLimiter,
  refreshLimiter,
} = require("../../middleware/rateLimiter");

const router = express.Router();

// Public Authentication Endpoints
router.post("/register", registerLimiter, authController.register);
router.post("/login", loginIpLimiter, loginIdentifierLimiter, authController.login);
router.post("/refresh", refreshLimiter, verifyCookieCsrf, authController.refresh);
router.post("/logout", verifyCookieCsrf, authController.logout);

// Protected Authentication & Profile Endpoints
router.post("/logout-all", protect, authController.logoutAll);
router.get("/me", protect, authController.getMe);
router.patch("/me", protect, userController.updateProfile);

module.exports = router;

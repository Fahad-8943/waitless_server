const express = require("express");
const authController = require("../../controllers/authController");
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

// Protected Authentication Endpoints
router.post("/logout-all", protect, authController.logoutAll);
router.get("/me", protect, authController.getMe);

module.exports = router;

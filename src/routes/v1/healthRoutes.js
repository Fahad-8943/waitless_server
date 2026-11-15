const express = require("express");
const { getHealth } = require("../../controllers/healthController");

const router = express.Router();

/**
 * @route   GET /api/v1/health
 * @desc    Health check endpoint reporting API and database connectivity
 * @access  Public
 */
router.get("/", getHealth);

module.exports = router;

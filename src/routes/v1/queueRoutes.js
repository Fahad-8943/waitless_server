const express = require("express");
const queueController = require("../../controllers/queueController");
const { protect } = require("../../middleware/auth");

const router = express.Router();

// Customer walk-in queue management
router.post("/", protect, queueController.joinQueue);
router.post("/join", protect, queueController.joinQueue);
router.get("/my", protect, queueController.getMyQueueEntries);
router.get("/my/active", protect, queueController.getMyQueueEntries);
router.get("/:queueEntryId", protect, queueController.getQueueEntryById);
router.patch("/:queueEntryId/leave", protect, queueController.leaveQueue);
router.patch("/:queueEntryId/cancel", protect, queueController.leaveQueue);

module.exports = router;

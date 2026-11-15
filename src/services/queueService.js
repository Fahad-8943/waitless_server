const mongoose = require("mongoose");
const QueueEntry = require("../models/QueueEntry");
const Business = require("../models/Business");
const Service = require("../models/Service");
const Counter = require("../models/Counter");
const ApiError = require("../utils/apiError");
const { withTransactionRetry } = require("../utils/transaction");
const { getLocalBusinessDateString } = require("../utils/timezone");

/**
 * Customer joins an active walk-in queue.
 * Strictly enforces business approval, active status, remoteQueueEnabled,
 * maxQueueCapacity, and prevents duplicate active entries.
 */
const joinQueue = async (customerId, data) => {
  const { businessId, serviceId, notes } = data;

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  if (business.approvalStatus !== "approved" || !business.isActive) {
    throw ApiError.badRequest(
      "Business is not currently accepting walk-ins",
      "BUSINESS_NOT_AVAILABLE"
    );
  }

  // 1. Policy check: remoteQueueEnabled
  if (business.policies && business.policies.remoteQueueEnabled === false) {
    throw ApiError.badRequest(
      "Remote queue joining is disabled for this business venue",
      "QUEUE_REMOTE_DISABLED"
    );
  }

  // 2. Optional Service Snapshot
  let serviceSnapshot = null;
  let serviceDoc = null;
  if (serviceId) {
    serviceDoc = await Service.findById(serviceId);
    if (!serviceDoc) {
      throw ApiError.notFound("Selected service not found", "SERVICE_NOT_FOUND");
    }
    if (serviceDoc.businessId.toString() !== business._id.toString() || !serviceDoc.isActive) {
      throw ApiError.badRequest(
        "Selected service is not currently available at this business",
        "SERVICE_NOT_AVAILABLE"
      );
    }
    serviceSnapshot = {
      serviceId: serviceDoc._id,
      name: serviceDoc.name,
      price: serviceDoc.price,
      duration: serviceDoc.duration,
    };
  }

  // 3. Timezone-aware date string according to venue's configured IANA timezone
  const tz = business.timezone || "Asia/Kolkata";
  const dateStr = getLocalBusinessDateString(new Date(), tz);

  // Pre-create collections if not already created to prevent collection creation inside transactions
  await Counter.createCollection().catch(() => {});
  await QueueEntry.createCollection().catch(() => {});

  // 4. Concurrency-safe queue join within transaction boundary
  const result = await withTransactionRetry(async (session) => {
    const opts = session ? { session } : {};

    // Policy check: maxQueueCapacity inside transaction
    const maxCapacity = (business.policies && business.policies.maxQueueCapacity) || 50;
    const activeCount = await QueueEntry.countDocuments(
      {
        businessId: business._id,
        status: { $in: ["waiting", "called", "serving"] },
      },
      opts
    );

    if (activeCount >= maxCapacity) {
      throw ApiError.badRequest(
        "Queue has reached maximum capacity. Please try again later.",
        "QUEUE_CAPACITY_EXCEEDED"
      );
    }

    // Duplicate check inside transaction
    const existingActive = await QueueEntry.findOne(
      {
        businessId: business._id,
        customerId,
        status: { $in: ["waiting", "called", "serving"] },
      },
      null,
      opts
    );

    if (existingActive) {
      throw ApiError.conflict(
        "You already have an active queue entry for this business",
        "DUPLICATE_QUEUE_ENTRY"
      );
    }

    // Atomic sequential token numbering inside transaction
    // Write lock on the Counter document guarantees strict serialization across concurrent requests
    const counter = await Counter.findOneAndUpdate(
      { businessId: business._id, dateStr },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true, ...opts }
    );

    const tokenNumber = counter.seq;
    const tokenDisplay = `Q-${String(tokenNumber).padStart(3, "0")}`;

    try {
      const [queueEntry] = await QueueEntry.create(
        [
          {
            businessId: business._id,
            customerId,
            serviceId: serviceDoc ? serviceDoc._id : null,
            serviceSnapshot: serviceSnapshot || undefined,
            tokenNumber,
            tokenDisplay,
            dateStr,
            status: "waiting",
            notes: notes || "",
            joinedAt: new Date(),
          },
        ],
        opts
      );

      return { queueEntry };
    } catch (err) {
      if (err.code === 11000) {
        throw ApiError.conflict(
          "You already have an active queue entry for this business",
          "DUPLICATE_QUEUE_ENTRY"
        );
      }
      throw err;
    }
  });

  const aheadCount = await QueueEntry.countDocuments({
    businessId: business._id,
    status: "waiting",
    joinedAt: { $lt: result.queueEntry.joinedAt },
  });

  const position = aheadCount + 1;

  return {
    queueEntry: result.queueEntry,
    position,
  };
};

/**
 * Retrieves active queue entries for the authenticated customer across all businesses.
 */
const getCustomerActiveQueueEntries = async (customerId) => {
  const entries = await QueueEntry.find({
    customerId,
    status: { $in: ["waiting", "called", "serving"] },
  })
    .sort({ joinedAt: -1 })
    .populate("businessId", "name category address contact")
    .lean();

  const entriesWithPosition = await Promise.all(
    entries.map(async (entry) => {
      let position = 0;
      if (entry.status === "waiting") {
        const aheadCount = await QueueEntry.countDocuments({
          businessId: entry.businessId._id,
          status: "waiting",
          joinedAt: { $lt: entry.joinedAt },
        });
        position = aheadCount + 1;
      }
      return {
        ...entry,
        position,
      };
    })
  );

  return entriesWithPosition;
};

/**
 * Retrieves a single queue entry with position and ownership checks.
 */
const getQueueEntryById = async (queueEntryId, userId, userRole) => {
  if (!mongoose.Types.ObjectId.isValid(queueEntryId)) {
    throw ApiError.badRequest("Invalid queue entry ID format", "INVALID_QUEUE_ENTRY_ID");
  }

  const entry = await QueueEntry.findById(queueEntryId)
    .populate("businessId", "name category address contact ownerId")
    .populate("customerId", "name email phone")
    .lean();

  if (!entry) {
    throw ApiError.notFound("Queue entry not found", "QUEUE_ENTRY_NOT_FOUND");
  }

  if (userRole === "admin") {
    // Admin access allowed
  } else {
    const isCustomer = entry.customerId?._id?.toString() === userId.toString();
    const isOwner = entry.businessId?.ownerId?.toString() === userId.toString();

    if (!isCustomer && !isOwner) {
      throw ApiError.forbidden(
        "Access denied: You do not have permission to view this queue entry",
        "FORBIDDEN_QUEUE_ACCESS"
      );
    }
  }

  let position = 0;
  if (entry.status === "waiting") {
    const aheadCount = await QueueEntry.countDocuments({
      businessId: entry.businessId._id,
      status: "waiting",
      joinedAt: { $lt: entry.joinedAt },
    });
    position = aheadCount + 1;
  }

  return {
    ...entry,
    position,
  };
};

/**
 * Customer cancels / leaves their active queue entry.
 */
const leaveQueue = async (queueEntryId, customerId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(queueEntryId)) {
    throw ApiError.badRequest("Invalid queue entry ID format", "INVALID_QUEUE_ENTRY_ID");
  }

  const entry = await QueueEntry.findById(queueEntryId);
  if (!entry) {
    throw ApiError.notFound("Queue entry not found", "QUEUE_ENTRY_NOT_FOUND");
  }

  if (entry.customerId.toString() !== customerId.toString()) {
    throw ApiError.forbidden(
      "Access denied: You do not own this queue entry",
      "FORBIDDEN_QUEUE_ACCESS"
    );
  }

  if (!["waiting", "called", "serving"].includes(entry.status)) {
    throw ApiError.badRequest(
      `Cannot leave queue in '${entry.status}' status`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  entry.status = "cancelled";
  entry.cancellationReason = reason || "Left queue";
  entry.cancelledAt = new Date();
  await entry.save();

  return entry;
};

/**
 * Provider views the current queue for their business venue.
 */
const getBusinessQueue = async (businessId, query = {}) => {
  const filter = { businessId };

  if (query.status) {
    filter.status = query.status;
  } else {
    // Default to active entries
    filter.status = { $in: ["waiting", "called", "serving"] };
  }

  const entries = await QueueEntry.find(filter)
    .sort({ joinedAt: 1 })
    .populate("customerId", "name email phone")
    .lean();

  const entriesWithPosition = await Promise.all(
    entries.map(async (entry) => {
      let position = 0;
      if (entry.status === "waiting") {
        const aheadCount = await QueueEntry.countDocuments({
          businessId,
          status: "waiting",
          joinedAt: { $lt: entry.joinedAt },
        });
        position = aheadCount + 1;
      }
      return {
        ...entry,
        position,
      };
    })
  );

  return {
    queue: entriesWithPosition,
    totalActive: entriesWithPosition.length,
  };
};

/**
 * Provider calls the next waiting customer (FIFO).
 */
const callNextCustomer = async (businessId) => {
  const nextEntry = await QueueEntry.findOneAndUpdate(
    { businessId, status: "waiting" },
    { $set: { status: "called", calledAt: new Date() } },
    { sort: { joinedAt: 1 }, new: true }
  ).populate("customerId", "name email phone");

  return nextEntry;
};

/**
 * Provider calls a specific waiting customer in queue.
 */
const callSpecificCustomer = async (businessId, queueEntryId) => {
  if (!mongoose.Types.ObjectId.isValid(queueEntryId)) {
    throw ApiError.badRequest("Invalid queue entry ID format", "INVALID_QUEUE_ENTRY_ID");
  }

  const entry = await QueueEntry.findOne({ _id: queueEntryId, businessId });
  if (!entry) {
    throw ApiError.notFound("Queue entry not found for this business", "QUEUE_ENTRY_NOT_FOUND");
  }

  if (entry.status !== "waiting") {
    throw ApiError.badRequest(
      `Cannot call customer in '${entry.status}' status. Only waiting entries can be called.`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  entry.status = "called";
  entry.calledAt = new Date();
  await entry.save();

  return entry;
};

/**
 * Provider marks a queue entry as completed.
 */
const completeQueueEntry = async (businessId, queueEntryId) => {
  if (!mongoose.Types.ObjectId.isValid(queueEntryId)) {
    throw ApiError.badRequest("Invalid queue entry ID format", "INVALID_QUEUE_ENTRY_ID");
  }

  const entry = await QueueEntry.findOne({ _id: queueEntryId, businessId });
  if (!entry) {
    throw ApiError.notFound("Queue entry not found for this business", "QUEUE_ENTRY_NOT_FOUND");
  }

  if (["completed", "skipped", "cancelled"].includes(entry.status)) {
    throw ApiError.badRequest(
      `Cannot complete queue entry in '${entry.status}' status`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  entry.status = "completed";
  entry.completedAt = new Date();
  await entry.save();

  return entry;
};

/**
 * Provider skips a customer in queue (e.g. no-show).
 */
const skipQueueEntry = async (businessId, queueEntryId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(queueEntryId)) {
    throw ApiError.badRequest("Invalid queue entry ID format", "INVALID_QUEUE_ENTRY_ID");
  }

  const entry = await QueueEntry.findOne({ _id: queueEntryId, businessId });
  if (!entry) {
    throw ApiError.notFound("Queue entry not found for this business", "QUEUE_ENTRY_NOT_FOUND");
  }

  if (["completed", "skipped", "cancelled"].includes(entry.status)) {
    throw ApiError.badRequest(
      `Cannot skip queue entry in '${entry.status}' status`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  entry.status = "skipped";
  entry.skippedAt = new Date();
  entry.cancellationReason = reason || "Customer skipped by provider";
  await entry.save();

  return entry;
};

module.exports = {
  joinQueue,
  getCustomerActiveQueueEntries,
  getQueueEntryById,
  leaveQueue,
  getBusinessQueue,
  callNextCustomer,
  callSpecificCustomer,
  completeQueueEntry,
  skipQueueEntry,
};

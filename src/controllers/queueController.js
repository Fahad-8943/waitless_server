const queueService = require("../services/queueService");
const ApiResponse = require("../utils/apiResponse");
const {
  joinQueueSchema,
  leaveQueueSchema,
  skipQueueSchema,
} = require("../validators/queueValidators");

/**
 * Customer joins a business walk-in queue.
 */
const joinQueue = async (req, res, next) => {
  try {
    const validatedData = joinQueueSchema.parse(req.body);
    const result = await queueService.joinQueue(req.user._id, validatedData);
    const entryData = {
      ...(result.queueEntry.toObject ? result.queueEntry.toObject() : result.queueEntry),
      position: result.position,
    };
    return ApiResponse.created(
      res,
      "Joined walk-in queue successfully",
      entryData,
      { position: result.position }
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Customer retrieves their active queue entries across businesses.
 */
const getMyQueueEntries = async (req, res, next) => {
  try {
    const entries = await queueService.getCustomerActiveQueueEntries(req.user._id);
    return ApiResponse.ok(res, "Active queue entries retrieved successfully", entries);
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve a single queue entry by ID (customer, business owner, or admin).
 */
const getQueueEntryById = async (req, res, next) => {
  try {
    const result = await queueService.getQueueEntryById(
      req.params.queueEntryId,
      req.user._id,
      req.user.role
    );
    return ApiResponse.ok(res, "Queue entry retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

/**
 * Customer leaves / cancels an active queue entry.
 */
const leaveQueue = async (req, res, next) => {
  try {
    const validatedData = leaveQueueSchema.parse(req.body || {});
    const entry = await queueService.leaveQueue(
      req.params.queueEntryId,
      req.user._id,
      validatedData.reason
    );
    return ApiResponse.ok(res, "Left queue successfully", entry);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider views the queue for their business venue.
 */
const getBusinessQueue = async (req, res, next) => {
  try {
    const result = await queueService.getBusinessQueue(req.params.businessId, req.query);
    return ApiResponse.ok(
      res,
      "Business queue retrieved successfully",
      result.queue,
      { totalActive: result.totalActive }
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Provider calls the next waiting customer.
 */
const callNextCustomer = async (req, res, next) => {
  try {
    const nextEntry = await queueService.callNextCustomer(req.params.businessId);
    if (!nextEntry) {
      return ApiResponse.ok(res, "Queue is currently empty. No waiting customers.", null);
    }
    return ApiResponse.ok(res, "Next customer called successfully", nextEntry);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider calls a specific waiting customer in queue.
 */
const callSpecificCustomer = async (req, res, next) => {
  try {
    const entry = await queueService.callSpecificCustomer(
      req.params.businessId,
      req.params.queueEntryId
    );
    return ApiResponse.ok(res, "Customer called successfully", entry);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider marks a queue entry as completed.
 */
const completeQueueEntry = async (req, res, next) => {
  try {
    const entry = await queueService.completeQueueEntry(
      req.params.businessId,
      req.params.queueEntryId
    );
    return ApiResponse.ok(res, "Queue entry completed successfully", entry);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider marks a queue entry as skipped.
 */
const skipQueueEntry = async (req, res, next) => {
  try {
    const validatedData = skipQueueSchema.parse(req.body || {});
    const entry = await queueService.skipQueueEntry(
      req.params.businessId,
      req.params.queueEntryId,
      validatedData.reason
    );
    return ApiResponse.ok(res, "Queue entry marked as skipped", entry);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  joinQueue,
  getMyQueueEntries,
  getQueueEntryById,
  leaveQueue,
  getBusinessQueue,
  callNextCustomer,
  callSpecificCustomer,
  completeQueueEntry,
  skipQueueEntry,
};

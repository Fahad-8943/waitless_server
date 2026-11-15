const { z } = require("zod");
const mongoose = require("mongoose");

/**
 * Validates ObjectId string format.
 */
const objectIdSchema = z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: "Invalid identifier format",
});

/**
 * Validation schema for joining a walk-in queue.
 * Strictly prevents mass-assignment.
 */
const joinQueueSchema = z
  .object({
    businessId: objectIdSchema,
    serviceId: objectIdSchema.optional(),
    notes: z
      .string()
      .trim()
      .max(500, "Notes cannot exceed 500 characters")
      .optional()
      .default(""),
  })
  .strict();

/**
 * Validation schema for leaving / cancelling a queue entry.
 */
const leaveQueueSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

/**
 * Validation schema for skipping a customer in queue.
 */
const skipQueueSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Skip reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

module.exports = {
  joinQueueSchema,
  leaveQueueSchema,
  skipQueueSchema,
};

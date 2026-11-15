const { z } = require("zod");
const mongoose = require("mongoose");

/**
 * Validates ObjectId string format.
 */
const objectIdSchema = z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: "Invalid identifier format",
});

/**
 * Validation schema for customer booking creation.
 * Strictly prevents mass-assignment and rejects internal fields.
 */
const createBookingSchema = z
  .object({
    businessId: objectIdSchema,
    serviceId: objectIdSchema,
    bookingDate: z
      .string({ required_error: "bookingDate is required" })
      .datetime({ message: "bookingDate must be a valid ISO 8601 datetime string" })
      .refine(
        (val) => new Date(val).getTime() > Date.now() - 60000,
        "bookingDate cannot be in the past"
      ),
    notes: z
      .string()
      .trim()
      .max(500, "Notes cannot exceed 500 characters")
      .optional()
      .default(""),
  })
  .strict();

/**
 * Validation schema for booking cancellation.
 */
const cancelBookingSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Cancellation reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

/**
 * Validation schema for provider rejecting a booking.
 */
const rejectBookingSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Rejection reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

module.exports = {
  createBookingSchema,
  cancelBookingSchema,
  rejectBookingSchema,
};

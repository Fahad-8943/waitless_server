const { z } = require("zod");
const mongoose = require("mongoose");

/**
 * Validates ObjectId string format.
 */
const objectIdSchema = z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: "Invalid identifier format",
});

/**
 * Schema for updating user active status.
 */
const updateUserStatusSchema = z
  .object({
    isActive: z.boolean({ required_error: "isActive boolean is required" }),
  })
  .strict();

/**
 * Schema for admin action reason (e.g., suspension, rejection).
 */
const adminReasonSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

/**
 * Schema for querying users in admin panel.
 */
const adminUserQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  role: z.enum(["customer", "provider", "admin"]).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  search: z.string().trim().optional(),
});

/**
 * Schema for querying businesses in admin panel.
 */
const adminBusinessQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  approvalStatus: z.enum(["pending", "approved", "suspended", "rejected"]).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  category: z.string().optional(),
  search: z.string().trim().optional(),
});

module.exports = {
  objectIdSchema,
  updateUserStatusSchema,
  adminReasonSchema,
  adminUserQuerySchema,
  adminBusinessQuerySchema,
};

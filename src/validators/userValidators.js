const { z } = require("zod");

/**
 * Validation schema for customer/user profile updates.
 * Strictly prevents modifications to role, passwordHash, tokenVersion,
 * verification flags, or account activation status.
 */
const updateUserProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters long")
      .max(100, "Name cannot exceed 100 characters")
      .optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email format")
      .optional()
      .nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^[+]?[0-9\s-]{7,20}$/, "Invalid phone number format")
      .optional()
      .nullable(),
  })
  .strict();

module.exports = {
  updateUserProfileSchema,
};

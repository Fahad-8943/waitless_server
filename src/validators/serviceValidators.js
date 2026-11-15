const { z } = require("zod");

/**
 * Validation schema for creating a new business service.
 * Strictly prevents mass-assignment of internal fields.
 */
const createServiceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Service name must be at least 2 characters long")
      .max(100, "Service name cannot exceed 100 characters"),
    description: z
      .string()
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .optional()
      .default(""),
    price: z
      .number({ invalid_type_error: "Price must be a valid number" })
      .min(0, "Price must be greater than or equal to 0"),
    duration: z
      .number({ invalid_type_error: "Duration must be a valid number" })
      .int("Duration must be an integer number of minutes")
      .min(1, "Duration must be at least 1 minute"),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

/**
 * Validation schema for partially updating an existing service.
 * Disallows modifying businessId, _id, or timestamps.
 */
const updateServiceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Service name must be at least 2 characters long")
      .max(100, "Service name cannot exceed 100 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .optional(),
    price: z
      .number({ invalid_type_error: "Price must be a valid number" })
      .min(0, "Price must be greater than or equal to 0")
      .optional(),
    duration: z
      .number({ invalid_type_error: "Duration must be a valid number" })
      .int("Duration must be an integer number of minutes")
      .min(1, "Duration must be at least 1 minute")
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

module.exports = {
  createServiceSchema,
  updateServiceSchema,
};

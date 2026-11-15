const { z } = require("zod");

/**
 * Validation schema for registering a new business venue.
 * Strictly prevents role/owner/approval status manipulation.
 */
const registerBusinessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters long")
    .max(100, "Business name cannot exceed 100 characters"),
  category: z.enum(
    [
      "Barbers & Salons",
      "Health & Clinics",
      "Auto Service & Repair",
      "Dining & Cafes",
      "Beauty & Wellness",
      "Fitness & Physical Therapy",
      "Other Local Service",
    ],
    {
      errorMap: () => ({ message: "Invalid business category specified" }),
    }
  ),
  description: z
    .string()
    .max(1000, "Description cannot exceed 1000 characters")
    .optional()
    .default(""),
  contact: z
    .object({
      email: z.string().trim().toLowerCase().email("Invalid email format").optional().nullable(),
      phone: z.string().trim().optional().nullable(),
    })
    .optional(),
  address: z.object({
    street: z.string().trim().min(1, "Street address is required"),
    city: z.string().trim().min(1, "City is required"),
    state: z.string().trim().min(1, "State is required"),
    postalCode: z.string().trim().min(1, "Postal code is required"),
    country: z.string().trim().default("IN"),
  }),
  location: z.object({
    coordinates: z
      .tuple([
        z.number().min(-180, "Longitude must be >= -180").max(180, "Longitude must be <= 180"),
        z.number().min(-90, "Latitude must be >= -90").max(90, "Latitude must be <= 90"),
      ])
      .refine((coords) => coords.length === 2, {
        message: "Coordinates must be a [longitude, latitude] pair",
      }),
  }),
  timezone: z.string().trim().default("Asia/Kolkata"),
  operatingHours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Open time must be in HH:mm format"),
        closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Close time must be in HH:mm format"),
        isOvernight: z.boolean().optional().default(false),
        isClosed: z.boolean().optional().default(false),
      })
    )
    .optional()
    .default([]),
  specialClosures: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Closure date must be in YYYY-MM-DD format"),
        reason: z.string().optional().default("Holiday"),
      })
    )
    .optional()
    .default([]),
  policies: z
    .object({
      maxQueueCapacity: z.number().int().min(1).optional().default(50),
      remoteQueueEnabled: z.boolean().optional().default(true),
      gracePeriodMinutes: z.number().int().min(0).optional().default(10),
    })
    .optional()
    .default({}),
});

module.exports = {
  registerBusinessSchema,
};

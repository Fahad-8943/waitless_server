const { z } = require("zod");

/**
 * Strict password schema enforcing complexity and bcrypt 72-byte UTF-8 ceiling.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .max(100, "Password cannot exceed 100 characters")
  .refine((val) => Buffer.byteLength(val, "utf8") <= 72, {
    message: "Password cannot exceed 72 bytes (UTF-8 encoding limit)",
  })
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

/**
 * Public registration validation schema.
 * Note: Role cannot be selected by the user. Any 'role' field passed is stripped.
 */
const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters long")
      .max(100, "Name cannot exceed 100 characters"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email address format")
      .optional()
      .nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^[+]?[0-9\s-]{7,20}$/, "Invalid phone number format")
      .optional()
      .nullable(),
    password: passwordSchema,
  })
  .refine(
    (data) => {
      const hasEmail = Boolean(data.email && data.email.trim().length > 0);
      const hasPhone = Boolean(data.phone && data.phone.trim().length > 0);
      return hasEmail || hasPhone;
    },
    {
      message: "At least one contact method (email or phone) must be provided",
      path: ["email"],
    }
  );

/**
 * Login validation schema.
 */
const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Email or phone identifier is required"),
  password: z
    .string()
    .min(1, "Password is required"),
});

module.exports = {
  passwordSchema,
  registerSchema,
  loginSchema,
};

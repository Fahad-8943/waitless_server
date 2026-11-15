const dotenv = require("dotenv");
const { z } = require("zod");
const logger = require("../utils/logger");

// Load .env file
dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z
      .string()
      .default("5000")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1000).max(65535)),
    MONGO_URI: z
      .string()
      .min(1, "MONGO_URI must be provided")
      .default("mongodb://localhost:27017/waitless_dev"),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

    // JWT Security
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters long")
      .default("waitless_development_jwt_access_secret_key_minimum_32_chars"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, "JWT_REFRESH_SECRET must be at least 32 characters long")
      .default("waitless_development_jwt_refresh_secret_key_minimum_32_chars"),
    JWT_ACCESS_EXPIRATION: z.string().default("15m"),
    JWT_REFRESH_EXPIRATION_DAYS: z
      .string()
      .default("7")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(90)),

    // Cookie Security
    COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    COOKIE_SECURE: z
      .string()
      .default("false")
      .transform((val) => val === "true" || val === "1"),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_PATH: z.string().default("/api/v1/auth"),

    // Reverse Proxy Configuration
    TRUST_PROXY: z
      .string()
      .default("false")
      .transform((val) => {
        if (val === "true" || val === "1") return true;
        if (val === "false" || val === "0") return false;
        const num = parseInt(val, 10);
        return isNaN(num) ? val : num;
      }),
  })
  .refine(
    (data) => {
      // Browsers reject SameSite=None if Secure is not true
      if (data.COOKIE_SAME_SITE === "none" && !data.COOKIE_SECURE) {
        return false;
      }
      return true;
    },
    {
      message: "COOKIE_SECURE must be true when COOKIE_SAME_SITE is 'none'",
      path: ["COOKIE_SECURE"],
    }
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error("Invalid environment configuration", {
    errors: parsed.error.format(),
  });
  throw new Error("Invalid environment configuration. Check your .env settings.");
}

module.exports = parsed.data;

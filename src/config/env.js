const dotenv = require("dotenv");
const { z } = require("zod");
const logger = require("../utils/logger");

// Load .env file
dotenv.config();

const envSchema = z.object({
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error("Invalid environment configuration", {
    errors: parsed.error.format(),
  });
  throw new Error("Invalid environment configuration. Check your .env settings.");
}

module.exports = parsed.data;

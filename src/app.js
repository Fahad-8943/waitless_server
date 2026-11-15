const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const v1Router = require("./routes/v1");
const notFoundHandler = require("./middleware/notFound");
const errorHandler = require("./middleware/error");
const ApiResponse = require("./utils/apiResponse");

const app = express();

// Security Headers
app.use(helmet());

// CORS Configuration with Explicit Whitelist
const allowedOrigins = [
  env.FRONTEND_URL,
  env.CORS_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server) with no Origin header
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin '${origin}' not allowed by CORS policy`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400, // 24 hours preflight cache
};

app.use(cors(corsOptions));

// HTTP Request Logger
if (env.NODE_ENV !== "test") {
  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: (req) => req.url === "/api/v1/health" && req.method === "GET", // Keep logs clean of frequent health probes
    })
  );
}

// Request Body Parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Root Information Route
app.get("/", (req, res) => {
  return ApiResponse.ok(res, "WaitLess Server API is active", {
    version: "1.0.0",
    docs: "/api/v1/health",
    environment: env.NODE_ENV,
  });
});

// Mount Versioned API Routes
app.use("/api/v1", v1Router);

// 404 Route Handler
app.use(notFoundHandler);

// Centralized Express 5 Error Handler
app.use(errorHandler);

module.exports = app;

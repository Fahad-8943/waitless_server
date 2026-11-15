const mongoose = require("mongoose");
const logger = require("../utils/logger");

let isConnected = false;

/**
 * Configure Mongoose event listeners for connection observability.
 * Note: The native MongoDB driver handles automatic reconnections; we only log events here.
 */
mongoose.connection.on("connected", () => {
  isConnected = true;
  logger.info("MongoDB connection established successfully", {
    host: mongoose.connection.host,
    name: mongoose.connection.name,
  });
});

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB connection error occurred", { error: err.message });
});

mongoose.connection.on("disconnected", () => {
  isConnected = false;
  logger.warn("MongoDB disconnected. Native driver will attempt auto-reconnect...");
});

/**
 * Connect to MongoDB with sensible pool and timeout options.
 * @param {string} mongoUri
 */
const connectDatabase = async (mongoUri) => {
  try {
    const options = {
      serverSelectionTimeoutMS: 5000, // Fail fast on initial boot if cluster unreachable
      maxPoolSize: 20,                // Maintain up to 20 socket connections
      minPoolSize: 2,                 // Keep at least 2 connections active in pool
      socketTimeoutMS: 45000,         // Close sockets after 45s of inactivity
    };

    logger.info("Connecting to MongoDB...", { uri: mongoUri.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@") });
    await mongoose.connect(mongoUri, options);
    return true;
  } catch (error) {
    logger.error("Initial MongoDB connection failed", {
      message: error.message,
      suggestion: "Verify that MongoDB is running or update MONGO_URI in .env",
    });
    // In development, do not crash immediately so the HTTP server can boot and serve health status
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    return false;
  }
};

/**
 * Cleanly close the database connection pool during graceful shutdown.
 */
const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    logger.info("Closing MongoDB connection pool...");
    await mongoose.connection.close(false);
    logger.info("MongoDB connection closed cleanly.");
  }
};

/**
 * Returns current database connection health state.
 */
const getDatabaseHealth = () => {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  const readyState = mongoose.connection.readyState;
  return {
    status: states[readyState] || "unknown",
    readyState,
    isConnected,
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null,
  };
};

module.exports = {
  connectDatabase,
  closeDatabase,
  getDatabaseHealth,
};

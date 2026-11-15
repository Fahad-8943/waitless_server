const app = require("./app");
const env = require("./config/env");
const { connectDatabase, closeDatabase } = require("./config/db");
const logger = require("./utils/logger");

let server;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase(env.MONGO_URI);

    // Start HTTP Listener
    server = app.listen(env.PORT, () => {
      logger.info(`WaitLess Server listening on port ${env.PORT}`, {
        port: env.PORT,
        environment: env.NODE_ENV,
        healthEndpoint: `http://localhost:${env.PORT}/api/v1/health`,
      });
    });
  } catch (error) {
    logger.error("Failed to start server", { error: error.message });
    process.exit(1);
  }
};

/**
 * Handle graceful process termination.
 * @param {string} signal
 */
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info("HTTP server closed.");
      try {
        await closeDatabase();
        logger.info("Graceful shutdown completed.");
        process.exit(0);
      } catch (err) {
        logger.error("Error during database shutdown", { error: err.message });
        process.exit(1);
      }
    });

    // Force exit after 10s timeout if connections remain open
    setTimeout(() => {
      logger.error("Graceful shutdown timed out. Forcing process exit.");
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
};

// Process Termination Signals
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.once("SIGUSR2", () => handleShutdown("SIGUSR2"));

// Global Unhandled Exceptions & Rejections
process.on("uncaughtException", (error) => {
  logger.error("UNCAUGHT EXCEPTION! Shutting down immediately...", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("UNHANDLED PROMISE REJECTION!", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  handleShutdown("unhandledRejection");
});

// Bootstrap Server
startServer();

module.exports = server;

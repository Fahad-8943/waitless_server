const { getDatabaseHealth } = require("../config/db");
const ApiResponse = require("../utils/apiResponse");

/**
 * Controller for system health inspection.
 */
const getHealth = (req, res) => {
  const dbHealth = getDatabaseHealth();
  const uptimeSeconds = Math.floor(process.uptime());
  const mem = process.memoryUsage();

  const isDegraded = dbHealth.status !== "connected";

  const healthData = {
    service: "WaitLess Server API",
    status: isDegraded ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    environment: process.env.NODE_ENV || "development",
    database: dbHealth,
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    },
  };

  const statusCode = isDegraded ? 200 : 200; // Return 200 with degraded state so monitoring tools receive structured status
  return ApiResponse.send(res, statusCode, "Health status check complete", healthData);
};

module.exports = {
  getHealth,
};

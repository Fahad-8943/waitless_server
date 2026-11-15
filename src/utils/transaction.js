const mongoose = require("mongoose");

/**
 * Execute an operation within a MongoDB transaction if a replica set is active.
 * Handles TransientTransactionError with exponential backoff retries.
 *
 * @param {Function} workFn - Async function taking (session) => Promise<any>
 * @param {number} maxRetries - Maximum retry attempts for transient errors (default: 3)
 * @returns {Promise<any>}
 */
const withTransactionRetry = async (workFn, maxRetries = 3) => {
  const isReplicaSet = Boolean(
    mongoose.connection.client &&
    mongoose.connection.client.topology &&
    mongoose.connection.client.topology.description.type !== "Single"
  );

  if (!isReplicaSet) {
    // Standalone single-node development mode fallback
    return await workFn(null);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await workFn(session);
      if (session.inTransaction()) {
        await session.commitTransaction();
      }
      return result;
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      const isTransient = err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError");
      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
};

module.exports = {
  withTransactionRetry,
};

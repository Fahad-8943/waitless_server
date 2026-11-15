const User = require("../models/User");
const logger = require("./logger");

/**
 * Migration helper: Safely migrate any legacy global users with role: 'staff' to role: 'customer'.
 * In the simplified WaitLess architecture, the active roles are strictly 'customer',
 * 'provider' (business owner), and 'admin' (platform admin).
 *
 * @returns {Promise<{ matchedCount: number, modifiedCount: number }>}
 */
const migrateLegacyStaffRoles = async () => {
  try {
    const result = await User.updateMany(
      { role: "staff" },
      { $set: { role: "customer" } }
    );

    if (result.modifiedCount > 0) {
      logger.info(
        `Successfully migrated ${result.modifiedCount} legacy user(s) from global 'staff' to 'customer' role.`
      );
    }

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  } catch (err) {
    logger.error("Failed to migrate legacy staff roles", { error: err.message });
    throw err;
  }
};

module.exports = {
  migrateLegacyStaffRoles,
};

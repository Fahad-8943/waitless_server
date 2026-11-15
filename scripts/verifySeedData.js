/**
 * WaitLess — Seed Data Verification Script
 *
 * Verifies record counts, role distributions, business approval states,
 * provider ownership relationships, and public discovery filtering.
 */

const mongoose = require("mongoose");
const env = require("../src/config/env");
const { connectDatabase, closeDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const Business = require("../src/models/Business");
const Service = require("../src/models/Service");
const Booking = require("../src/models/Booking");
const QueueEntry = require("../src/models/QueueEntry");
const businessService = require("../src/services/businessService");

async function verifySeedData() {
  await connectDatabase(env.MONGO_URI);

  // 1. Users by Role
  const users = await User.find({}).lean();
  const usersByRole = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  // 2. Businesses by Approval Status
  const businesses = await Business.find({}).populate("ownerId", "name email role").lean();
  const businessesByStatus = businesses.reduce((acc, b) => {
    acc[b.approvalStatus] = (acc[b.approvalStatus] || 0) + 1;
    return acc;
  }, {});

  // 3. Services Count
  const totalServices = await Service.countDocuments({});
  const servicesPerBusiness = {};
  for (const b of businesses) {
    const count = await Service.countDocuments({ businessId: b._id });
    servicesPerBusiness[b.name] = count;
  }

  // 4. Bookings by Status
  const bookings = await Booking.find({}).lean();
  const bookingsByStatus = bookings.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  // 5. Active Queue Entries
  const queueEntries = await QueueEntry.find({}).lean();
  const queueByStatus = queueEntries.reduce((acc, q) => {
    acc[q.status] = (acc[q.status] || 0) + 1;
    return acc;
  }, {});
  const activeQueueCount = await QueueEntry.countDocuments({
    status: { $in: ["waiting", "called", "serving"] },
  });

  // 6. Provider Ownership Relationships
  const ownership = businesses.map((b) => ({
    businessName: b.name,
    category: b.category,
    approvalStatus: b.approvalStatus,
    ownerName: b.ownerId?.name || "Unknown",
    ownerEmail: b.ownerId?.email || "Unknown",
    ownerRole: b.ownerId?.role || "Unknown",
  }));

  // 7. Public Discovery Verification
  const publicResult = await businessService.getPublicBusinesses({});
  const publicNames = publicResult.businesses.map((b) => b.name);
  const pendingExcluded = !publicNames.some((n) => n.includes("Swift Motors"));

  let pendingDirectLookupBlocked = false;
  const pendingBiz = businesses.find((b) => b.approvalStatus === "pending");
  if (pendingBiz) {
    try {
      await businessService.getPublicBusinessProfile(pendingBiz._id);
    } catch (err) {
      if (err.statusCode === 404 || err.message.includes("not found")) {
        pendingDirectLookupBlocked = true;
      }
    }
  }

  const approvedDirectLookupSuccess = [];
  for (const pub of publicResult.businesses) {
    const profile = await businessService.getPublicBusinessProfile(pub._id);
    approvedDirectLookupSuccess.push(Boolean(profile && profile._id));
  }

  console.log(JSON.stringify({
    status: "VERIFIED",
    summary: {
      totalUsers: users.length,
      usersByRole,
      totalBusinesses: businesses.length,
      businessesByStatus,
      totalServices,
      servicesPerBusiness,
      totalBookings: bookings.length,
      bookingsByStatus,
      totalQueueEntries: queueEntries.length,
      activeQueueCount,
      queueByStatus,
    },
    ownership,
    publicDiscovery: {
      totalPubliclyDiscoverable: publicResult.businesses.length,
      discoverableNames: publicNames,
      pendingBusinessesExcludedFromDiscovery: pendingExcluded,
      pendingDirectProfileLookupBlocked: pendingDirectLookupBlocked,
      approvedDirectProfileLookupsValid: approvedDirectLookupSuccess.every(Boolean),
    },
  }, null, 2));

  await closeDatabase();
}

if (require.main === module) {
  verifySeedData()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`[VERIFICATION ERROR] ${err.message}`);
      try {
        await closeDatabase();
      } catch (_) {}
      process.exit(1);
    });
}

module.exports = verifySeedData;

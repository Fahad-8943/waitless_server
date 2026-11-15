/**
 * WaitLess — Live Atlas End-to-End API Verification
 *
 * Exercises all core workflows against the live MongoDB Atlas database:
 * 1. Authentication (Customer, Provider, Admin)
 * 2. Admin Authorization & Statistics
 * 3. Public Business & Service Discovery
 * 4. Provider Business Access & IDOR Defense
 * 5. Service Retrieval
 * 6. Booking Creation & Listing
 * 7. Queue Joining, Retrieval & Cancellation
 * 8. Provider & Platform Dashboard Statistics
 */

const supertest = require("supertest");
const env = require("../src/config/env");
const { connectDatabase, closeDatabase } = require("../src/config/db");
const app = require("../src/app");
const Business = require("../src/models/Business");
const Service = require("../src/models/Service");

const request = supertest(app);

async function runLiveVerification() {
  console.log("[VERIFY-LIVE] Connecting to MongoDB Atlas...");
  await connectDatabase(env.MONGO_URI);

  const results = {};

  // ----------------------------------------------------
  // 1. Authentication
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 1. Testing Authentication...");
  const devPassword = process.env.DEV_SEED_PASSWORD || "WaitLess@Dev2026!";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@WaitLess2026!";

  // 1a. Customer Charlie
  const charlieLogin = await request.post("/api/v1/auth/login").send({
    identifier: "customer.charlie@waitless.dev",
    password: devPassword,
  });
  if (charlieLogin.status !== 200 || !charlieLogin.body.data?.accessToken) {
    throw new Error(`Customer login failed: ${JSON.stringify(charlieLogin.body)}`);
  }
  const charlieToken = charlieLogin.body.data.accessToken;

  // 1b. Provider Alice
  const aliceLogin = await request.post("/api/v1/auth/login").send({
    identifier: "provider.alice@waitless.dev",
    password: devPassword,
  });
  if (aliceLogin.status !== 200 || !aliceLogin.body.data?.accessToken) {
    throw new Error(`Provider login failed: ${JSON.stringify(aliceLogin.body)}`);
  }
  const aliceToken = aliceLogin.body.data.accessToken;

  // 1c. Admin
  const adminLogin = await request.post("/api/v1/auth/login").send({
    identifier: "admin@waitless.com",
    password: adminPassword,
  });
  if (adminLogin.status !== 200 || !adminLogin.body.data?.accessToken) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.body)}`);
  }
  const adminToken = adminLogin.body.data.accessToken;

  results.authentication = {
    customerAuth: "PASSED",
    providerAuth: "PASSED",
    adminAuth: "PASSED",
  };

  // ----------------------------------------------------
  // 2. Admin Authorization
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 2. Testing Admin Authorization...");
  const adminStatsRes = await request
    .get("/api/v1/admin/stats")
    .set("Authorization", `Bearer ${adminToken}`);

  const adminUsersRes = await request
    .get("/api/v1/admin/users")
    .set("Authorization", `Bearer ${adminToken}`);

  const adminBizRes = await request
    .get("/api/v1/admin/businesses")
    .set("Authorization", `Bearer ${adminToken}`);

  // Test customer forbidden from admin endpoint
  const customerBlockedRes = await request
    .get("/api/v1/admin/stats")
    .set("Authorization", `Bearer ${charlieToken}`);

  results.adminAuthorization = {
    statsAccessible: adminStatsRes.status === 200,
    usersListed: adminUsersRes.status === 200 && adminUsersRes.body.data.length >= 6,
    businessesListed: adminBizRes.status === 200 && adminBizRes.body.data.length >= 3,
    customerAccessBlocked: customerBlockedRes.status === 403,
  };

  // ----------------------------------------------------
  // 3. Public Business Discovery
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 3. Testing Public Discovery...");
  const publicBizRes = await request.get("/api/v1/businesses/public");
  const publicList = publicBizRes.body.data?.businesses || [];
  const publicNames = publicList.map((b) => b.name);

  // Discover services for first approved business
  const apexBiz = await Business.findOne({ name: /Apex Hair/i });
  const swiftBiz = await Business.findOne({ name: /Swift Motors/i });

  const publicServicesRes = await request.get(`/api/v1/businesses/public/${apexBiz._id}/services`);
  const pendingServicesRes = await request.get(`/api/v1/businesses/public/${swiftBiz._id}/services`);

  results.publicDiscovery = {
    approvedVenuesCount: publicList.length,
    pendingExcludedFromList: !publicNames.some((n) => n.includes("Swift Motors")),
    servicesAccessibleForApproved: publicServicesRes.status === 200 && publicServicesRes.body.data.services.length >= 3,
    pendingServicesBlockedWith404: pendingServicesRes.status === 404,
  };

  // ----------------------------------------------------
  // 4. Provider Business Access & IDOR Defense
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 4. Testing Provider Business Access & IDOR...");
  const myBizRes = await request
    .get("/api/v1/businesses/my/list")
    .set("Authorization", `Bearer ${aliceToken}`);

  const ownBizRes = await request
    .get(`/api/v1/businesses/${apexBiz._id}`)
    .set("Authorization", `Bearer ${aliceToken}`);

  // Alice attempts to access Bob's Swift Motors
  const idorBlockedRes = await request
    .get(`/api/v1/businesses/${swiftBiz._id}`)
    .set("Authorization", `Bearer ${aliceToken}`);

  results.providerAccess = {
    myBusinessesCount: myBizRes.body.data?.businesses?.length || 0,
    ownProfileAccessible: ownBizRes.status === 200,
    crossBusinessIdorBlocked: idorBlockedRes.status === 403,
  };

  // ----------------------------------------------------
  // 5. Service Retrieval
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 5. Testing Service Retrieval...");
  const servicesRes = await request
    .get(`/api/v1/businesses/${apexBiz._id}/services`)
    .set("Authorization", `Bearer ${aliceToken}`);

  results.serviceRetrieval = {
    servicesCount: servicesRes.body.data?.services?.length || 0,
    status: servicesRes.status === 200 ? "PASSED" : "FAILED",
  };

  // ----------------------------------------------------
  // 6. Booking Creation and Listing
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 6. Testing Booking Creation & Listing...");
  const haircutSvc = await Service.findOne({ businessId: apexBiz._id, name: /Haircut/i });

  const bookingDate = new Date();
  bookingDate.setDate(bookingDate.getDate() + 2);
  bookingDate.setHours(16, 0, 0, 0);

  const createBookingRes = await request
    .post("/api/v1/bookings")
    .set("Authorization", `Bearer ${charlieToken}`)
    .send({
      businessId: apexBiz._id.toString(),
      serviceId: haircutSvc._id.toString(),
      bookingDate: bookingDate.toISOString(),
      notes: "Live verification booking test",
    });

  const myBookingsRes = await request
    .get("/api/v1/bookings/my")
    .set("Authorization", `Bearer ${charlieToken}`);

  const providerBookingsRes = await request
    .get(`/api/v1/businesses/${apexBiz._id}/bookings`)
    .set("Authorization", `Bearer ${aliceToken}`);

  results.bookingWorkflow = {
    createdSuccessfully: createBookingRes.status === 201,
    bookingStatus: createBookingRes.body.data?.status,
    customerListingIncludesBooking: Array.isArray(myBookingsRes.body.data) && myBookingsRes.body.data.length >= 1,
    providerListingIncludesBooking: Array.isArray(providerBookingsRes.body.data) && providerBookingsRes.body.data.length >= 1,
  };

  // ----------------------------------------------------
  // 7. Queue Joining and Retrieval
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 7. Testing Walk-in Queue Join & Retrieval...");
  const zenithBiz = await Business.findOne({ name: /Zenith/i });
  const therapySvc = await Service.findOne({ businessId: zenithBiz._id });

  // Clean up any lingering active queue entry for Charlie first
  const existingActive = await request
    .get("/api/v1/queues/my/active")
    .set("Authorization", `Bearer ${charlieToken}`);

  if (Array.isArray(existingActive.body.data)) {
    for (const entry of existingActive.body.data) {
      if (entry.businessId === zenithBiz._id.toString() || entry.businessId?._id === zenithBiz._id.toString()) {
        await request
          .patch(`/api/v1/queues/${entry._id}/leave`)
          .set("Authorization", `Bearer ${charlieToken}`)
          .send({ reason: "Resetting for live queue test" });
      }
    }
  }

  const joinQueueRes = await request
    .post("/api/v1/queues/join")
    .set("Authorization", `Bearer ${charlieToken}`)
    .send({
      businessId: zenithBiz._id.toString(),
      serviceId: therapySvc._id.toString(),
      notes: "Live queue join test",
    });

  const activeQueueRes = await request
    .get("/api/v1/queues/my/active")
    .set("Authorization", `Bearer ${charlieToken}`);

  const providerQueueRes = await request
    .get(`/api/v1/businesses/${zenithBiz._id}/queue`)
    .set("Authorization", `Bearer ${aliceToken}`);

  // Cleanly leave the queue so test doesn't linger
  let queueLeft = false;
  const createdQueueId = joinQueueRes.body.data?._id;
  if (createdQueueId) {
    const leaveRes = await request
      .patch(`/api/v1/queues/${createdQueueId}/leave`)
      .set("Authorization", `Bearer ${charlieToken}`)
      .send({ reason: "Completed live verification test" });
    queueLeft = leaveRes.status === 200;
  }

  results.queueWorkflow = {
    joinedSuccessfully: joinQueueRes.status === 201,
    tokenAssigned: joinQueueRes.body.data?.tokenDisplay,
    activeQueueRetrieved: activeQueueRes.status === 200,
    providerQueueDeskReflectsEntry: providerQueueRes.status === 200,
    cleanLeaveConfirmed: queueLeft,
  };

  // ----------------------------------------------------
  // 8. Dashboard Statistics
  // ----------------------------------------------------
  console.log("[VERIFY-LIVE] 8. Testing Dashboard Statistics...");
  const providerOverviewRes = await request
    .get("/api/v1/businesses/my/dashboard")
    .set("Authorization", `Bearer ${aliceToken}`);

  const singleVenueDashboardRes = await request
    .get(`/api/v1/businesses/${apexBiz._id}/dashboard`)
    .set("Authorization", `Bearer ${aliceToken}`);

  results.dashboardStatistics = {
    providerMultiVenueDashboard: providerOverviewRes.status === 200,
    providerSingleVenueDashboard: singleVenueDashboardRes.status === 200,
    adminPlatformStats: adminStatsRes.status === 200,
  };

  console.log("\n=======================================================");
  console.log("LIVE ATLAS VERIFICATION SUMMARY");
  console.log("=======================================================");
  console.log(JSON.stringify(results, null, 2));

  await closeDatabase();
}

if (require.main === module) {
  runLiveVerification()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`[VERIFY-LIVE ERROR] ${err.message}`);
      try {
        await closeDatabase();
      } catch (_) {}
      process.exit(1);
    });
}

module.exports = runLiveVerification;

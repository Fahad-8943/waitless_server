const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test_jwt_access_secret_key_minimum_32_characters_long_for_security";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret_key_minimum_32_characters_long_for_security";
process.env.COOKIE_SAME_SITE = "lax";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_PATH = "/api/v1/auth";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DEFAULT_BUSINESS_APPROVAL_STATUS = "approved";

const app = require("../../src/app");
const User = require("../../src/models/User");
const Business = require("../../src/models/Business");
const Service = require("../../src/models/Service");
const Booking = require("../../src/models/Booking");
const QueueEntry = require("../../src/models/QueueEntry");
const Counter = require("../../src/models/Counter");
const { signAccessToken } = require("../../src/services/authService");
const { getLocalBusinessDateString } = require("../../src/utils/timezone");

let replSet;

const sampleBusinessPayload = {
  name: "Apex Barbershop",
  category: "Barbers & Salons",
  description: "Modern urban grooming and classic beard styling.",
  contact: {
    email: "contact@apexbarbers.com",
    phone: "+919876543210",
  },
  address: {
    street: "104 Brigade Road",
    city: "Bangalore",
    state: "Karnataka",
    postalCode: "560025",
    country: "IN",
  },
  location: {
    coordinates: [77.6074, 12.9738],
  },
  timezone: "Asia/Kolkata",
  policies: {
    maxQueueCapacity: 2,
    remoteQueueEnabled: true,
    gracePeriodMinutes: 10,
  },
};

describe("Batch 2 — Booking Management & Walk-in Queue Integration Tests", () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Business.deleteMany({});
    await Service.deleteMany({});
    await Booking.deleteMany({});
    await QueueEntry.deleteMany({});
    await Counter.deleteMany({});
  });

  const createTestUser = async ({ name, email, phone, role = "customer", tokenVersion = 0 }) => {
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: "$2a$12$e8vK1N1/wD7C4oA8f.W.eeM6h6PqvR7h7D8e8w9f0g1h2i3j4k5l6",
      role,
      tokenVersion,
      isActive: true,
    });
    const token = signAccessToken(user);
    return { user, token };
  };

  const setupBusinessWithService = async (ownerOverrides = {}, businessOverrides = {}) => {
    const { user: owner, token: ownerToken } = await createTestUser({
      name: ownerOverrides.name || "Owner Bob",
      email: ownerOverrides.email || `owner_${Date.now()}_${Math.random()}@example.com`,
      role: "provider",
      tokenVersion: 1,
    });

    const business = await Business.create({
      ...sampleBusinessPayload,
      ...businessOverrides,
      ownerId: owner._id,
      approvalStatus: businessOverrides.approvalStatus || "approved",
      isActive: businessOverrides.isActive !== undefined ? businessOverrides.isActive : true,
    });

    const service = await Service.create({
      businessId: business._id,
      name: "Signature Haircut",
      description: "Includes wash and style",
      price: 350,
      duration: 30,
      isActive: true,
    });

    return { owner, ownerToken, business, service };
  };

  // ==========================================
  // PART 1: Booking Management
  // ==========================================
  describe("1. Booking Management", () => {
    it("1.1 Customer creates a booking and service is snapshotted at creation time", async () => {
      const { business, service } = await setupBusinessWithService();
      const { user: customer, token: customerToken } = await createTestUser({
        name: "Alice Customer",
        email: "alice@customer.com",
        role: "customer",
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString(); // Tomorrow

      const res = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
          bookingDate: futureDate,
          notes: "Please be gentle",
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      const booking = res.body.data;
      assert.strictEqual(booking.status, "pending");
      assert.strictEqual(booking.customerId.toString(), customer._id.toString());
      assert.strictEqual(booking.businessId.toString(), business._id.toString());
      assert.strictEqual(booking.serviceSnapshot.name, "Signature Haircut");
      assert.strictEqual(booking.serviceSnapshot.price, 350);
      assert.strictEqual(booking.serviceSnapshot.duration, 30);
    });

    it("1.2 Should reject booking if business is not approved or is inactive", async () => {
      const { service } = await setupBusinessWithService({}, { approvalStatus: "pending" });
      const { token: customerToken } = await createTestUser({
        name: "Alice",
        email: "alice2@customer.com",
      });

      const res = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: service.businessId.toString(),
          serviceId: service._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "BUSINESS_NOT_BOOKABLE");
    });

    it("1.3 Should reject booking if service is inactive", async () => {
      const { business, service } = await setupBusinessWithService();
      await Service.findByIdAndUpdate(service._id, { isActive: false });

      const { token: customerToken } = await createTestUser({
        name: "Alice",
        email: "alice3@customer.com",
      });

      const res = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "SERVICE_NOT_BOOKABLE");
    });

    it("1.4 Customer views their own bookings and details, but cannot view another customer's booking", async () => {
      const { business, service } = await setupBusinessWithService();
      const { user: alice, token: aliceToken } = await createTestUser({
        name: "Alice",
        email: "alice4@customer.com",
      });
      const { user: bob, token: bobToken } = await createTestUser({
        name: "Bob Customer",
        email: "bob_cust@example.com",
      });

      // Alice books
      const createRes = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });
      const bookingId = createRes.body.data._id;

      // Alice gets her bookings
      const listRes = await request(app)
        .get("/api/v1/bookings/my")
        .set("Authorization", `Bearer ${aliceToken}`);
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.body.data.length, 1);
      assert.strictEqual(listRes.body.data[0]._id, bookingId);

      // Alice views booking detail
      const detailRes = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set("Authorization", `Bearer ${aliceToken}`);
      assert.strictEqual(detailRes.status, 200);
      assert.strictEqual(detailRes.body.data._id, bookingId);

      // Bob tries to view Alice's booking -> 403 Forbidden
      const bobRes = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set("Authorization", `Bearer ${bobToken}`);
      assert.strictEqual(bobRes.status, 403);
      assert.strictEqual(bobRes.body.error.code, "FORBIDDEN_BOOKING_ACCESS");
    });

    it("1.5 Customer can cancel pending or confirmed booking, but not completed or cancelled ones", async () => {
      const { business, service } = await setupBusinessWithService();
      const { token: customerToken } = await createTestUser({
        name: "Alice",
        email: "alice5@customer.com",
      });

      const createRes = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });
      const bookingId = createRes.body.data._id;

      // Cancel pending booking
      const cancelRes = await request(app)
        .patch(`/api/v1/bookings/${bookingId}/cancel`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ reason: "Emergency conflict" });
      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelRes.body.data.status, "cancelled");
      assert.strictEqual(cancelRes.body.data.cancellationReason, "Emergency conflict");

      // Attempting to cancel again should fail with invalid status transition
      const repeatCancelRes = await request(app)
        .patch(`/api/v1/bookings/${bookingId}/cancel`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ reason: "Duplicate cancel" });
      assert.strictEqual(repeatCancelRes.status, 400);
      assert.strictEqual(repeatCancelRes.body.error.code, "INVALID_STATUS_TRANSITION");
    });

    it("1.6 Provider confirms, completes, and rejects bookings with IDOR defense", async () => {
      const { owner: providerA, ownerToken: tokenA, business: businessA, service: serviceA } =
        await setupBusinessWithService({ name: "Provider A", email: "proA@test.com" });
      const { owner: providerB, ownerToken: tokenB, business: businessB } =
        await setupBusinessWithService({ name: "Provider B", email: "proB@test.com" });

      const { token: customerToken } = await createTestUser({
        name: "Charlie",
        email: "charlie@test.com",
      });

      // Customer books with Business A
      const createRes = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: businessA._id.toString(),
          serviceId: serviceA._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });
      const bookingId = createRes.body.data._id;

      // Provider B tries to confirm Provider A's booking -> 403 Forbidden
      const idorRes = await request(app)
        .patch(`/api/v1/businesses/${businessA._id}/bookings/${bookingId}/confirm`)
        .set("Authorization", `Bearer ${tokenB}`);
      assert.strictEqual(idorRes.status, 403);
      assert.strictEqual(idorRes.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");

      // Provider A confirms booking
      const confirmRes = await request(app)
        .patch(`/api/v1/businesses/${businessA._id}/bookings/${bookingId}/confirm`)
        .set("Authorization", `Bearer ${tokenA}`);
      assert.strictEqual(confirmRes.status, 200);
      assert.strictEqual(confirmRes.body.data.status, "confirmed");

      // Provider A marks as completed
      const completeRes = await request(app)
        .patch(`/api/v1/businesses/${businessA._id}/bookings/${bookingId}/complete`)
        .set("Authorization", `Bearer ${tokenA}`);
      assert.strictEqual(completeRes.status, 200);
      assert.strictEqual(completeRes.body.data.status, "completed");

      // Attempting to confirm an already completed booking fails
      const invalidRes = await request(app)
        .patch(`/api/v1/businesses/${businessA._id}/bookings/${bookingId}/confirm`)
        .set("Authorization", `Bearer ${tokenA}`);
      assert.strictEqual(invalidRes.status, 400);
      assert.strictEqual(invalidRes.body.error.code, "INVALID_STATUS_TRANSITION");
    });

    it("1.7 Should reject booking completion directly from pending status", async () => {
      const { ownerToken, business, service } = await setupBusinessWithService();
      const { token: customerToken } = await createTestUser({
        name: "Pending Complete Cust",
        email: "pending_complete@test.com",
      });

      const createRes = await request(app)
        .post("/api/v1/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
          bookingDate: new Date(Date.now() + 86400000).toISOString(),
        });
      assert.strictEqual(createRes.status, 201);
      const bookingId = createRes.body.data._id;

      // Attempting to complete directly from pending status must be rejected
      const directCompleteRes = await request(app)
        .patch(`/api/v1/businesses/${business._id}/bookings/${bookingId}/complete`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(directCompleteRes.status, 400);
      assert.strictEqual(directCompleteRes.body.error.code, "INVALID_STATUS_TRANSITION");
    });
  });

  // ==========================================
  // PART 2: Walk-in Queue Management
  // ==========================================
  describe("2. Walk-in Queue Management", () => {
    it("2.1 Customer joins queue and receives a sequential unique token and position", async () => {
      const { business, service } = await setupBusinessWithService();
      const { token: cust1Token } = await createTestUser({
        name: "Cust 1",
        email: "cust1@test.com",
      });
      const { token: cust2Token } = await createTestUser({
        name: "Cust 2",
        email: "cust2@test.com",
      });

      // Cust 1 joins
      const res1 = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${cust1Token}`)
        .send({
          businessId: business._id.toString(),
          serviceId: service._id.toString(),
        });
      assert.strictEqual(res1.status, 201);
      assert.strictEqual(res1.body.data.tokenNumber, 1);
      assert.strictEqual(res1.body.data.tokenDisplay, "Q-001");
      assert.strictEqual(res1.body.data.status, "waiting");
      assert.strictEqual(res1.body.meta.position, 1);

      // Cust 2 joins
      const res2 = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${cust2Token}`)
        .send({
          businessId: business._id.toString(),
        });
      assert.strictEqual(res2.status, 201);
      assert.strictEqual(res2.body.data.tokenNumber, 2);
      assert.strictEqual(res2.body.data.tokenDisplay, "Q-002");
      assert.strictEqual(res2.body.meta.position, 2);
    });

    it("2.2 Should prevent duplicate active queue entries for same customer at same business", async () => {
      const { business } = await setupBusinessWithService();
      const { token: custToken } = await createTestUser({
        name: "Repeat Cust",
        email: "repeat@test.com",
      });

      // First join succeeds
      const firstJoin = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(firstJoin.status, 201);

      // Second join should be rejected with 409 Conflict
      const secondJoin = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(secondJoin.status, 409);
      assert.strictEqual(secondJoin.body.error.code, "DUPLICATE_QUEUE_ENTRY");
    });

    it("2.3 Should enforce maxQueueCapacity policy", async () => {
      // Setup business with maxQueueCapacity = 1
      const { business } = await setupBusinessWithService(
        {},
        { policies: { maxQueueCapacity: 1, remoteQueueEnabled: true } }
      );
      const { token: cust1Token } = await createTestUser({ name: "Customer One", email: "c1@test.com" });
      const { token: cust2Token } = await createTestUser({ name: "Customer Two", email: "c2@test.com" });

      // First customer fills capacity
      const res1 = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${cust1Token}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(res1.status, 201);

      // Second customer rejected due to capacity limit
      const res2 = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${cust2Token}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(res2.status, 400);
      assert.strictEqual(res2.body.error.code, "QUEUE_CAPACITY_EXCEEDED");
    });

    it("2.4 Should enforce remoteQueueEnabled policy", async () => {
      const { business } = await setupBusinessWithService(
        {},
        { policies: { maxQueueCapacity: 50, remoteQueueEnabled: false } }
      );
      const { token: custToken } = await createTestUser({ name: "Customer Remote", email: "cremote@test.com" });

      const res = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, "QUEUE_REMOTE_DISABLED");
    });

    it("2.5 Customer leaves queue and can subsequently re-join", async () => {
      const { business } = await setupBusinessWithService();
      const { token: custToken } = await createTestUser({ name: "Customer Leaver", email: "leave@test.com" });

      const joinRes = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });
      const entryId = joinRes.body.data._id;

      // Leave queue
      const leaveRes = await request(app)
        .patch(`/api/v1/queues/${entryId}/leave`)
        .set("Authorization", `Bearer ${custToken}`)
        .send({ reason: "Changed mind" });
      assert.strictEqual(leaveRes.status, 200);
      assert.strictEqual(leaveRes.body.data.status, "cancelled");

      // Now customer can join again
      const rejoinRes = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(rejoinRes.status, 201);
    });

    it("2.6 Provider views queue, calls next customer, and completes or skips", async () => {
      const { ownerToken, business } = await setupBusinessWithService();
      const { token: c1 } = await createTestUser({ name: "User 1", email: "u1@test.com" });
      const { token: c2 } = await createTestUser({ name: "User 2", email: "u2@test.com" });

      await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${c1}`)
        .send({ businessId: business._id.toString() });

      await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${c2}`)
        .send({ businessId: business._id.toString() });

      // Provider checks queue
      const queueRes = await request(app)
        .get(`/api/v1/businesses/${business._id}/queue`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(queueRes.status, 200);
      assert.strictEqual(queueRes.body.data.length, 2);
      assert.strictEqual(queueRes.body.data[0].tokenNumber, 1);
      assert.strictEqual(queueRes.body.data[1].tokenNumber, 2);

      // Provider calls next customer (User 1)
      const callRes = await request(app)
        .post(`/api/v1/businesses/${business._id}/queue/call-next`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(callRes.status, 200);
      assert.strictEqual(callRes.body.data.tokenNumber, 1);
      assert.strictEqual(callRes.body.data.status, "called");

      // Provider marks User 1 as completed
      const entryId1 = callRes.body.data._id;
      const completeRes = await request(app)
        .patch(`/api/v1/businesses/${business._id}/queue/${entryId1}/complete`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(completeRes.status, 200);
      assert.strictEqual(completeRes.body.data.status, "completed");

      // Provider calls next customer (User 2)
      const callNextRes = await request(app)
        .post(`/api/v1/businesses/${business._id}/queue/call-next`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(callNextRes.status, 200);
      assert.strictEqual(callNextRes.body.data.tokenNumber, 2);

      // Provider skips User 2 (no-show)
      const entryId2 = callNextRes.body.data._id;
      const skipRes = await request(app)
        .patch(`/api/v1/businesses/${business._id}/queue/${entryId2}/skip`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ reason: "Customer did not show up" });
      assert.strictEqual(skipRes.status, 200);
      assert.strictEqual(skipRes.body.data.status, "skipped");

      // Calling next when queue is empty returns null
      const emptyCallRes = await request(app)
        .post(`/api/v1/businesses/${business._id}/queue/call-next`)
        .set("Authorization", `Bearer ${ownerToken}`);
      assert.strictEqual(emptyCallRes.status, 200);
      assert.strictEqual(emptyCallRes.body.data, null);
    });

    it("2.7 Should handle simultaneous queue joins safely when only one capacity slot remains", async () => {
      // maxQueueCapacity is 2
      const { business } = await setupBusinessWithService(
        {},
        { policies: { maxQueueCapacity: 2, remoteQueueEnabled: true } }
      );
      const { token: c1Token } = await createTestUser({ name: "Slot One", email: "slot1@test.com" });
      const { token: c2Token } = await createTestUser({ name: "Race Candidate 1", email: "race1@test.com" });
      const { token: c3Token } = await createTestUser({ name: "Race Candidate 2", email: "race2@test.com" });

      // First customer occupies slot 1 of 2
      const res1 = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${c1Token}`)
        .send({ businessId: business._id.toString() });
      assert.strictEqual(res1.status, 201);

      // Now exactly 1 capacity slot remains. Two customers join concurrently.
      const [raceRes1, raceRes2] = await Promise.all([
        request(app)
          .post("/api/v1/queues")
          .set("Authorization", `Bearer ${c2Token}`)
          .send({ businessId: business._id.toString() }),
        request(app)
          .post("/api/v1/queues")
          .set("Authorization", `Bearer ${c3Token}`)
          .send({ businessId: business._id.toString() }),
      ]);

      const statuses = [raceRes1.status, raceRes2.status].sort();
      // Exactly one succeeds (201) and the loser receives 400 QUEUE_CAPACITY_EXCEEDED
      assert.deepStrictEqual(statuses, [201, 400]);

      const failedRes = raceRes1.status === 400 ? raceRes1 : raceRes2;
      assert.strictEqual(failedRes.body.error.code, "QUEUE_CAPACITY_EXCEEDED");

      // Verify that total active entries in database never exceeded capacity of 2
      const activeCount = await QueueEntry.countDocuments({
        businessId: business._id,
        status: { $in: ["waiting", "called", "serving"] },
      });
      assert.strictEqual(activeCount, 2);
    });

    it("2.8 Should generate sequential queue tokens using business-local timezone date", async () => {
      const nyTimezone = "America/New_York";
      const { business } = await setupBusinessWithService(
        {},
        { timezone: nyTimezone }
      );
      const { token: custToken } = await createTestUser({
        name: "Timezone Cust",
        email: "tz_cust@test.com",
      });

      const res = await request(app)
        .post("/api/v1/queues")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ businessId: business._id.toString() });

      assert.strictEqual(res.status, 201);
      const expectedDateStr = getLocalBusinessDateString(new Date(), nyTimezone);
      assert.strictEqual(res.body.data.dateStr, expectedDateStr);
      assert.strictEqual(res.body.data.tokenNumber, 1);
      assert.strictEqual(res.body.data.tokenDisplay, "Q-001");
    });
  });
});

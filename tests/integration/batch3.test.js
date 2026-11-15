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
    maxQueueCapacity: 50,
    remoteQueueEnabled: true,
  },
};

describe("Batch 3 — Provider Dashboard & Platform Admin Integration Tests", () => {
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

  const createTestUser = async ({ name, email, phone, role = "customer", tokenVersion = 0, isActive = true }) => {
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: "$2a$12$e8vK1N1/wD7C4oA8f.W.eeM6h6PqvR7h7D8e8w9f0g1h2i3j4k5l6",
      role,
      tokenVersion,
      isActive,
    });
    const token = signAccessToken(user);
    return { user, token };
  };

  const setupBusiness = async (owner, overrides = {}) => {
    return await Business.create({
      ...sampleBusinessPayload,
      ...overrides,
      ownerId: owner._id,
      approvalStatus: overrides.approvalStatus || "approved",
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    });
  };

  // ==========================================
  // PART 1: Provider Dashboard
  // ==========================================
  describe("1. Provider Dashboard", () => {
    it("1.1 Should return complete scoped analytics for a specific owned business", async () => {
      const { user: provider, token: providerToken } = await createTestUser({
        name: "Barber Sam",
        email: "sam@barber.com",
        role: "provider",
        tokenVersion: 1,
      });

      const business = await setupBusiness(provider);

      // Create services
      await Service.create({
        businessId: business._id,
        name: "Haircut",
        price: 300,
        duration: 30,
        isActive: true,
      });
      await Service.create({
        businessId: business._id,
        name: "Coloring (Retired)",
        price: 800,
        duration: 60,
        isActive: false,
      });

      // Create customers & bookings
      const { user: customer1 } = await createTestUser({ name: "Cust One", email: "c1@test.com" });
      const { user: customer2 } = await createTestUser({ name: "Cust Two", email: "c2@test.com" });

      const today = new Date();
      await Booking.create({
        businessId: business._id,
        customerId: customer1._id,
        serviceId: new mongoose.Types.ObjectId(),
        serviceSnapshot: { serviceId: new mongoose.Types.ObjectId(), name: "Haircut", price: 300, duration: 30 },
        bookingDate: today,
        status: "pending",
      });
      await Booking.create({
        businessId: business._id,
        customerId: customer2._id,
        serviceId: new mongoose.Types.ObjectId(),
        serviceSnapshot: { serviceId: new mongoose.Types.ObjectId(), name: "Haircut", price: 300, duration: 30 },
        bookingDate: today,
        status: "confirmed",
      });

      // Create queue entries
      await QueueEntry.create({
        businessId: business._id,
        customerId: customer1._id,
        tokenNumber: 1,
        tokenDisplay: "Q-001",
        dateStr: today.toISOString().slice(0, 10),
        status: "called",
        calledAt: new Date(),
      });
      await QueueEntry.create({
        businessId: business._id,
        customerId: customer2._id,
        tokenNumber: 2,
        tokenDisplay: "Q-002",
        dateStr: today.toISOString().slice(0, 10),
        status: "waiting",
      });

      // Fetch dashboard
      const res = await request(app)
        .get(`/api/v1/businesses/${business._id}/dashboard`)
        .set("Authorization", `Bearer ${providerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;

      // Assert bookings metrics
      assert.strictEqual(data.bookings.total, 2);
      assert.strictEqual(data.bookings.pending, 1);
      assert.strictEqual(data.bookings.confirmed, 1);
      assert.strictEqual(data.bookings.todayCount, 2);

      // Assert queue metrics
      assert.strictEqual(data.queue.totalActive, 2);
      assert.strictEqual(data.queue.waitingCount, 1);
      assert.strictEqual(data.queue.calledCount, 1);
      assert.strictEqual(data.queue.currentlyCalled.tokenDisplay, "Q-001");

      // Assert service metrics
      assert.strictEqual(data.services.total, 2);
      assert.strictEqual(data.services.active, 1);
      assert.strictEqual(data.services.inactive, 1);

      // Assert recent activity
      assert.strictEqual(data.recentActivity.bookings.length, 2);
      assert.strictEqual(data.recentActivity.queue.length, 2);
    });

    it("1.2 Should prevent customer from accessing provider dashboard", async () => {
      const { user: provider } = await createTestUser({
        name: "Provider",
        email: "prov@test.com",
        role: "provider",
      });
      const business = await setupBusiness(provider);

      const { token: customerToken } = await createTestUser({
        name: "Customer",
        email: "cust@test.com",
        role: "customer",
      });

      const res = await request(app)
        .get(`/api/v1/businesses/${business._id}/dashboard`)
        .set("Authorization", `Bearer ${customerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");
    });

    it("1.3 Should prevent Provider A from accessing Provider B's business dashboard (IDOR)", async () => {
      const { user: providerA } = await createTestUser({
        name: "Provider A",
        email: "pa@test.com",
        role: "provider",
      });
      const businessA = await setupBusiness(providerA);

      const { token: providerBToken } = await createTestUser({
        name: "Provider B",
        email: "pb@test.com",
        role: "provider",
      });

      const res = await request(app)
        .get(`/api/v1/businesses/${businessA._id}/dashboard`)
        .set("Authorization", `Bearer ${providerBToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");
    });

    it("1.4 Should return multi-business overview aggregated for a provider", async () => {
      const { user: provider, token: providerToken } = await createTestUser({
        name: "Multi Owner",
        email: "multi@owner.com",
        role: "provider",
      });

      const b1 = await setupBusiness(provider, { name: "Salon Downtown" });
      const b2 = await setupBusiness(provider, { name: "Salon Uptown" });

      await Service.create({
        businessId: b1._id,
        name: "Cut 1",
        price: 200,
        duration: 30,
        isActive: true,
      });
      await Service.create({
        businessId: b2._id,
        name: "Cut 2",
        price: 250,
        duration: 30,
        isActive: true,
      });

      const res = await request(app)
        .get("/api/v1/businesses/my/dashboard")
        .set("Authorization", `Bearer ${providerToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.totalBusinesses, 2);
      assert.strictEqual(res.body.data.businesses.length, 2);
      assert.strictEqual(res.body.data.aggregatedStats.totalActiveServices, 2);
    });
  });

  // ==========================================
  // PART 2: Platform Admin Dashboard & Controls
  // ==========================================
  describe("2. Platform Admin Dashboard & Moderation", () => {
    it("2.1 Platform admin retrieves platform-wide aggregate statistics", async () => {
      const { token: adminToken } = await createTestUser({
        name: "Super Admin",
        email: "admin@waitless.com",
        role: "admin",
      });

      const { user: provider } = await createTestUser({
        name: "Owner",
        email: "own@test.com",
        role: "provider",
      });
      await setupBusiness(provider, { approvalStatus: "pending" });
      await setupBusiness(provider, { approvalStatus: "approved" });

      const res = await request(app)
        .get("/api/v1/admin/stats")
        .set("Authorization", `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const stats = res.body.data;
      assert.strictEqual(stats.users.total, 2);
      assert.strictEqual(stats.users.byRole.admin, 1);
      assert.strictEqual(stats.users.byRole.provider, 1);
      assert.strictEqual(stats.businesses.total, 2);
      assert.strictEqual(stats.businesses.byApprovalStatus.pending, 1);
      assert.strictEqual(stats.businesses.byApprovalStatus.approved, 1);
    });

    it("2.2 Provider or customer must never access platform-wide admin statistics", async () => {
      const { token: providerToken } = await createTestUser({
        name: "Provider",
        email: "prov_admin_block@test.com",
        role: "provider",
      });

      const res = await request(app)
        .get("/api/v1/admin/stats")
        .set("Authorization", `Bearer ${providerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN");
    });

    it("2.3 Admin lists users with search and role filter, passwordHash is stripped", async () => {
      const { token: adminToken } = await createTestUser({
        name: "Super Admin",
        email: "admin2@waitless.com",
        role: "admin",
      });

      await createTestUser({ name: "Alice Customer", email: "alice_find@customer.com", role: "customer" });
      await createTestUser({ name: "Bob Provider", email: "bob_find@provider.com", role: "provider" });

      // Filter by customer
      const filterRes = await request(app)
        .get("/api/v1/admin/users?role=customer")
        .set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(filterRes.status, 200);
      assert.strictEqual(filterRes.body.data.length, 1);
      assert.strictEqual(filterRes.body.data[0].role, "customer");
      assert.strictEqual(filterRes.body.data[0].passwordHash, undefined);

      // Search by name
      const searchRes = await request(app)
        .get("/api/v1/admin/users?search=Bob")
        .set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(searchRes.status, 200);
      assert.strictEqual(searchRes.body.data.length, 1);
      assert.strictEqual(searchRes.body.data[0].name, "Bob Provider");
    });

    it("2.4 Admin lists businesses with approval-status and search filters", async () => {
      const { token: adminToken } = await createTestUser({
        name: "Admin",
        email: "admin3@test.com",
        role: "admin",
      });
      const { user: provider } = await createTestUser({
        name: "Provider",
        email: "prov3@test.com",
        role: "provider",
      });

      await setupBusiness(provider, { name: "City Cuts", approvalStatus: "pending" });
      await setupBusiness(provider, { name: "Metro Grooming", approvalStatus: "approved" });

      const res = await request(app)
        .get("/api/v1/admin/businesses?approvalStatus=pending")
        .set("Authorization", `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].name, "City Cuts");
      assert.strictEqual(res.body.data[0].approvalStatus, "pending");
    });

    it("2.5 Admin approves and rejects businesses", async () => {
      const { token: adminToken } = await createTestUser({
        name: "Admin",
        email: "admin4@test.com",
        role: "admin",
      });
      const { user: provider } = await createTestUser({
        name: "Provider",
        email: "prov4@test.com",
        role: "provider",
      });

      const business = await setupBusiness(provider, { approvalStatus: "pending" });

      // Approve
      const approveRes = await request(app)
        .patch(`/api/v1/admin/businesses/${business._id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(approveRes.status, 200);
      assert.strictEqual(approveRes.body.data.approvalStatus, "approved");
      assert.strictEqual(approveRes.body.data.isActive, true);

      // Reject
      const rejectRes = await request(app)
        .patch(`/api/v1/admin/businesses/${business._id}/reject`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Incomplete documentation" });
      assert.strictEqual(rejectRes.status, 200);
      assert.strictEqual(rejectRes.body.data.approvalStatus, "rejected");
    });

    it("2.6 Admin suspends and reactivates businesses", async () => {
      const { token: adminToken } = await createTestUser({
        name: "Admin",
        email: "admin5@test.com",
        role: "admin",
      });
      const { user: provider } = await createTestUser({
        name: "Provider",
        email: "prov5@test.com",
        role: "provider",
      });

      const business = await setupBusiness(provider, { approvalStatus: "approved" });

      // Suspend
      const suspendRes = await request(app)
        .patch(`/api/v1/admin/businesses/${business._id}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Regulatory inspection failed" });
      assert.strictEqual(suspendRes.status, 200);
      assert.strictEqual(suspendRes.body.data.approvalStatus, "suspended");

      // Reactivate
      const reactivateRes = await request(app)
        .patch(`/api/v1/admin/businesses/${business._id}/reactivate`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.strictEqual(reactivateRes.status, 200);
      assert.strictEqual(reactivateRes.body.data.approvalStatus, "approved");
      assert.strictEqual(reactivateRes.body.data.isActive, true);
    });

    it("2.7 Admin deactivates user, invalidates session, and enforces safety against last admin", async () => {
      const { user: admin1, token: adminToken } = await createTestUser({
        name: "Only Admin",
        email: "admin_only@test.com",
        role: "admin",
      });

      const { user: targetCustomer, token: custToken } = await createTestUser({
        name: "Target Customer",
        email: "target@customer.com",
      });

      // 1. Deactivate target user
      const deactRes = await request(app)
        .patch(`/api/v1/admin/users/${targetCustomer._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isActive: false });
      assert.strictEqual(deactRes.status, 200);
      assert.strictEqual(deactRes.body.data.isActive, false);

      // Verify deactivated user's token is immediately rejected
      const custReq = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${custToken}`);
      assert.strictEqual(custReq.status, 403);
      assert.strictEqual(custReq.body.error.code, "ACCOUNT_DISABLED");

      // 2. Reactivate user
      const reactRes = await request(app)
        .patch(`/api/v1/admin/users/${targetCustomer._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isActive: true });
      assert.strictEqual(reactRes.status, 200);
      assert.strictEqual(reactRes.body.data.isActive, true);

      // 3. Safety: Admin cannot deactivate themselves
      const selfDeactRes = await request(app)
        .patch(`/api/v1/admin/users/${admin1._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isActive: false });
      assert.strictEqual(selfDeactRes.status, 400);
      assert.strictEqual(selfDeactRes.body.error.code, "UNSAFE_ADMIN_ACTION");
    });

    it("2.8 Admin lists businesses with search filter matching address.city", async () => {
      const { token: adminToken } = await createTestUser({
        name: "City Admin",
        email: "city_admin@waitless.com",
        role: "admin",
      });
      const { user: provider } = await createTestUser({
        name: "City Provider",
        email: "city_prov@test.com",
        role: "provider",
      });

      await setupBusiness(provider, {
        name: "Palace Salon",
        address: {
          street: "123 Palace Road",
          city: "Mysore",
          state: "Karnataka",
          postalCode: "570001",
          country: "IN",
        },
      });

      await setupBusiness(provider, {
        name: "Metro Salon",
        address: {
          street: "456 MG Road",
          city: "Bangalore",
          state: "Karnataka",
          postalCode: "560001",
          country: "IN",
        },
      });

      // Search by city "Mysore"
      const res = await request(app)
        .get("/api/v1/admin/businesses?search=Mysore")
        .set("Authorization", `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].name, "Palace Salon");
      assert.strictEqual(res.body.data[0].address.city, "Mysore");
    });
  });
});

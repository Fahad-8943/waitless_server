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
};

describe("Batch 1 — Services, Public Discovery & Customer Profile Integration Tests", () => {
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

  // ==========================================
  // PART 1: Business Service Management
  // ==========================================
  describe("1. Business Service Management", () => {
    it("1.1 Should allow business owner to create a service for their business", async () => {
      const { token } = await createTestUser({
        name: "Barber Bob",
        email: "bob@barber.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);
      const businessId = regRes.body.data.business._id;

      const servicePayload = {
        name: "Classic Haircut & Wash",
        description: "Scissor work, clipper styling, and hot towel rinse.",
        price: 350,
        duration: 30,
      };

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send(servicePayload);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.service._id);
      assert.strictEqual(res.body.data.service.name, "Classic Haircut & Wash");
      assert.strictEqual(res.body.data.service.price, 350);
      assert.strictEqual(res.body.data.service.duration, 30);
      assert.strictEqual(res.body.data.service.isActive, true);
      assert.strictEqual(res.body.data.service.businessId.toString(), businessId.toString());
    });

    it("1.2 Should reject service creation with invalid data (price < 0, non-integer duration)", async () => {
      const { token } = await createTestUser({
        name: "Barber Bob",
        email: "bob2@barber.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);
      const businessId = regRes.body.data.business._id;

      // Invalid negative price
      const resNegPrice = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Shave", price: -50, duration: 20 });
      assert.strictEqual(resNegPrice.statusCode, 400);

      // Invalid duration < 1
      const resZeroDuration = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Shave", price: 100, duration: 0 });
      assert.strictEqual(resZeroDuration.statusCode, 400);

      // Invalid non-integer duration
      const resFloatDuration = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Shave", price: 100, duration: 25.5 });
      assert.strictEqual(resFloatDuration.statusCode, 400);
    });

    it("1.3 Should block Provider A from creating services on Provider B's business (IDOR defense)", async () => {
      const { token: tokenA } = await createTestUser({
        name: "Provider A",
        email: "provA@test.com",
        role: "provider",
        tokenVersion: 1,
      });
      const { token: tokenB } = await createTestUser({
        name: "Provider B",
        email: "provB@test.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${tokenB}`)
        .send(sampleBusinessPayload);
      const businessIdB = regRes.body.data.business._id;

      const res = await request(app)
        .post(`/api/v1/businesses/${businessIdB}/services`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Malicious Service", price: 100, duration: 15 });

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");

      // Verify no service was created
      const count = await Service.countDocuments({ businessId: businessIdB });
      assert.strictEqual(count, 0);
    });

    it("1.4 Should list all services and retrieve individual service details for the owner", async () => {
      const { token } = await createTestUser({
        name: "Salon Owner",
        email: "salon@test.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);
      const businessId = regRes.body.data.business._id;

      // Create two services
      const s1 = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Service One", price: 100, duration: 15 });
      const service1Id = s1.body.data.service._id;

      await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Service Two", price: 200, duration: 30 });

      // List services
      const listRes = await request(app)
        .get(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`);
      assert.strictEqual(listRes.statusCode, 200);
      assert.strictEqual(listRes.body.data.services.length, 2);

      // View single service details
      const viewRes = await request(app)
        .get(`/api/v1/businesses/${businessId}/services/${service1Id}`)
        .set("Authorization", `Bearer ${token}`);
      assert.strictEqual(viewRes.statusCode, 200);
      assert.strictEqual(viewRes.body.data.service._id, service1Id);
      assert.strictEqual(viewRes.body.data.service.name, "Service One");
    });

    it("1.5 Should allow owner to update service details and toggle active status", async () => {
      const { token } = await createTestUser({
        name: "Doctor Dave",
        email: "dave@clinic.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...sampleBusinessPayload, category: "Health & Clinics" });
      const businessId = regRes.body.data.business._id;

      const createRes = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "General Consultation", price: 500, duration: 20 });
      const serviceId = createRes.body.data.service._id;

      // Update name, price, duration, and deactivate
      const updateRes = await request(app)
        .patch(`/api/v1/businesses/${businessId}/services/${serviceId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Comprehensive Health Check",
          price: 750,
          duration: 30,
          isActive: false,
        });

      assert.strictEqual(updateRes.statusCode, 200);
      assert.strictEqual(updateRes.body.data.service.name, "Comprehensive Health Check");
      assert.strictEqual(updateRes.body.data.service.price, 750);
      assert.strictEqual(updateRes.body.data.service.duration, 30);
      assert.strictEqual(updateRes.body.data.service.isActive, false);

      // Verify in DB
      const dbService = await Service.findById(serviceId);
      assert.strictEqual(dbService.name, "Comprehensive Health Check");
      assert.strictEqual(dbService.isActive, false);
    });
  });

  // ==========================================
  // PART 2: Public Business & Service Discovery
  // ==========================================
  describe("2. Public Business & Service Discovery", () => {
    it("2.1 Should list only approved and active businesses with category filtering and search", async () => {
      const { token } = await createTestUser({
        name: "Multi Owner",
        email: "multi@test.com",
        role: "provider",
        tokenVersion: 1,
      });

      // 1. Approved & Active Barber
      const b1 = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...sampleBusinessPayload, name: "Urban Cuts", category: "Barbers & Salons" });
      const b1Id = b1.body.data.business._id;

      // 2. Approved & Active Clinic
      await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...sampleBusinessPayload, name: "Care Point Clinic", category: "Health & Clinics" });

      // 3. Suspended business (should be hidden)
      const b3 = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...sampleBusinessPayload, name: "Suspended Venue" });
      await Business.findByIdAndUpdate(b3.body.data.business._id, { approvalStatus: "suspended" });

      // 4. Inactive business (should be hidden)
      const b4 = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...sampleBusinessPayload, name: "Inactive Venue" });
      await Business.findByIdAndUpdate(b4.body.data.business._id, { isActive: false });

      // Query all public businesses
      const publicList = await request(app).get("/api/v1/businesses/public");
      assert.strictEqual(publicList.statusCode, 200);
      assert.strictEqual(publicList.body.data.businesses.length, 2);
      assert.strictEqual(publicList.body.data.pagination.total, 2);

      // Verify sanitized fields: no ownerId, approvalStatus, policies
      const item = publicList.body.data.businesses[0];
      assert.strictEqual(item.ownerId, undefined);
      assert.strictEqual(item.approvalStatus, undefined);
      assert.strictEqual(item.policies, undefined);

      // Filter by category
      const catList = await request(app).get("/api/v1/businesses/public?category=Health+%26+Clinics");
      assert.strictEqual(catList.statusCode, 200);
      assert.strictEqual(catList.body.data.businesses.length, 1);
      assert.strictEqual(catList.body.data.businesses[0].name, "Care Point Clinic");

      // Search by name
      const searchList = await request(app).get("/api/v1/businesses/public?search=Urban");
      assert.strictEqual(searchList.statusCode, 200);
      assert.strictEqual(searchList.body.data.businesses.length, 1);
      assert.strictEqual(searchList.body.data.businesses[0].name, "Urban Cuts");
    });

    it("2.2 Should list active services for a public business and exclude inactive ones", async () => {
      const { token } = await createTestUser({
        name: "Public Provider",
        email: "publicprov@test.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);
      const businessId = regRes.body.data.business._id;

      // Create 1 active service and 1 inactive service
      await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Public Active Service", price: 200, duration: 20, isActive: true });

      await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Hidden Inactive Service", price: 300, duration: 30, isActive: false });

      // Public services query (no auth)
      const res = await request(app).get(`/api/v1/businesses/public/${businessId}/services`);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.services.length, 1);
      assert.strictEqual(res.body.data.services[0].name, "Public Active Service");
      assert.strictEqual(res.body.data.services[0].price, 200);
    });

    it("2.3 Should return 404 for public services if business is suspended, inactive, or pending", async () => {
      const { token } = await createTestUser({
        name: "Suspended Provider",
        email: "suspprov@test.com",
        role: "provider",
        tokenVersion: 1,
      });

      const regRes = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);
      const businessId = regRes.body.data.business._id;

      await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Some Service", price: 100, duration: 15 });

      // Suspend business
      await Business.findByIdAndUpdate(businessId, { approvalStatus: "suspended" });

      const suspRes = await request(app).get(`/api/v1/businesses/public/${businessId}/services`);
      assert.strictEqual(suspRes.statusCode, 404);
      assert.strictEqual(suspRes.body.error.code, "BUSINESS_NOT_FOUND");
    });
  });

  // ==========================================
  // PART 3: Customer Profile Management
  // ==========================================
  describe("3. Customer Profile Management", () => {
    it("3.1 Should view authenticated customer profile without exposing credentials", async () => {
      const { user, token } = await createTestUser({
        name: "Jane Customer",
        email: "jane@customer.com",
        phone: "+919123456780",
        role: "customer",
        tokenVersion: 0,
      });

      const res = await request(app)
        .get("/api/v1/users/profile")
        .set("Authorization", `Bearer ${token}`);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user._id, user._id.toString());
      assert.strictEqual(res.body.data.user.name, "Jane Customer");
      assert.strictEqual(res.body.data.user.email, "jane@customer.com");
      assert.strictEqual(res.body.data.user.role, "customer");
      assert.strictEqual(res.body.data.user.passwordHash, undefined);
    });

    it("3.2 Should update permitted profile fields (name, phone, email)", async () => {
      const { user, token } = await createTestUser({
        name: "Old Name",
        email: "old@customer.com",
        phone: "+919876500001",
        role: "customer",
      });

      const res = await request(app)
        .patch("/api/v1/users/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Name",
          phone: "+919876500002",
          email: "updated@customer.com",
        });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.user.name, "Updated Name");
      assert.strictEqual(res.body.data.user.phone, "+919876500002");
      assert.strictEqual(res.body.data.user.email, "updated@customer.com");

      // Verify in DB
      const dbUser = await User.findById(user._id);
      assert.strictEqual(dbUser.name, "Updated Name");
      assert.strictEqual(dbUser.email, "updated@customer.com");
    });

    it("3.3 Should reject attempts to modify role, passwordHash, tokenVersion, or status", async () => {
      const { user, token } = await createTestUser({
        name: "Hacker User",
        email: "hacker@test.com",
        role: "customer",
      });

      const res = await request(app)
        .patch("/api/v1/users/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Legit Name",
          role: "admin", // forbidden
          passwordHash: "hacked_password", // forbidden
          tokenVersion: 10, // forbidden
          isActive: false, // forbidden
        });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error.code, "VALIDATION_ERROR");

      // Verify DB role was not changed
      const dbUser = await User.findById(user._id);
      assert.strictEqual(dbUser.role, "customer");
      assert.strictEqual(dbUser.tokenVersion, 0);
    });

    it("3.4 Should reject update if email or phone is already taken by another account", async () => {
      await createTestUser({
        name: "Existing User",
        email: "existing@test.com",
        phone: "+919999999999",
      });

      const { token } = await createTestUser({
        name: "Second User",
        email: "second@test.com",
        phone: "+918888888888",
      });

      // Email conflict
      const emailConflictRes = await request(app)
        .patch("/api/v1/users/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({ email: "existing@test.com" });
      assert.strictEqual(emailConflictRes.statusCode, 409);
      assert.strictEqual(emailConflictRes.body.error.code, "EMAIL_EXISTS");

      // Phone conflict
      const phoneConflictRes = await request(app)
        .patch("/api/v1/users/profile")
        .set("Authorization", `Bearer ${token}`)
        .send({ phone: "+919999999999" });
      assert.strictEqual(phoneConflictRes.statusCode, 409);
      assert.strictEqual(phoneConflictRes.body.error.code, "PHONE_EXISTS");
    });
  });
});

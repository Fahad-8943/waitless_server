const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Configure test environment variables before loading application
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
const RefreshToken = require("../../src/models/RefreshToken");
const { signAccessToken } = require("../../src/services/authService");
const { migrateLegacyStaffRoles } = require("../../src/utils/migrations");
const env = require("../../src/config/env");

let replSet;

// Sample valid business registration payload
const sampleBusinessPayload = {
  name: "Crown & Blade Studio",
  category: "Barbers & Salons",
  description: "Master haircutting and hot towel shaves",
  contact: { email: "contact@crownblade.com", phone: "+919876543210" },
  address: {
    street: "428 Market St",
    city: "Bangalore",
    state: "Karnataka",
    postalCode: "560001",
    country: "IN",
  },
  location: {
    coordinates: [77.5946, 12.9716], // [longitude, latitude]
  },
  timezone: "Asia/Kolkata",
  operatingHours: [
    { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: true },
    { dayOfWeek: 1, openTime: "09:00", closeTime: "20:00", isClosed: false },
    { dayOfWeek: 2, openTime: "09:00", closeTime: "20:00", isClosed: false },
    { dayOfWeek: 3, openTime: "09:00", closeTime: "20:00", isClosed: false },
    { dayOfWeek: 4, openTime: "09:00", closeTime: "20:00", isClosed: false },
    { dayOfWeek: 5, openTime: "09:00", closeTime: "21:00", isClosed: false },
    { dayOfWeek: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
  ],
  policies: {
    maxQueueCapacity: 50,
    remoteQueueEnabled: true,
    gracePeriodMinutes: 10,
  },
};

describe("Simplified Business Ownership & Authorization Integration Tests", () => {
  before(async () => {
    // Start In-Memory MongoDB Replica Set to support multi-document transactions
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
    await RefreshToken.deleteMany({});
  });

  // Helper to create a user and generate their access token
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

  // 1. Atomic Registration & Direct Ownership
  it("1. Should transactionally register a business, bind ownerId to user, elevate customer to provider, and increment tokenVersion", async () => {
    const { user, token: initialToken } = await createTestUser({
      name: "Alice Owner",
      email: "alice@example.com",
      role: "customer",
      tokenVersion: 0,
    });

    const res = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${initialToken}`)
      .send(sampleBusinessPayload);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.business._id);
    assert.strictEqual(res.body.data.business.name, "Crown & Blade Studio");
    assert.strictEqual(res.body.data.business.ownerId.toString(), user._id.toString());
    assert.strictEqual(res.body.data.business.approvalStatus, "approved");
    assert.ok(res.body.data.accessToken, "Should return fresh access token after role elevation");

    // Database verification: User model
    const dbUser = await User.findById(user._id);
    assert.strictEqual(dbUser.role, "provider", "User role must be elevated to provider");
    assert.strictEqual(dbUser.tokenVersion, 1, "tokenVersion must be incremented by 1");

    // Database verification: Business model
    const dbBusiness = await Business.findById(res.body.data.business._id);
    assert.strictEqual(dbBusiness.ownerId.toString(), user._id.toString());
  });

  // 2. Old Token Invalidation & New Token Validity
  it("2. Should invalidate old customer token immediately and accept newly issued provider token", async () => {
    const { token: oldToken } = await createTestUser({
      name: "Bob Stylist",
      email: "bob@example.com",
      role: "customer",
      tokenVersion: 0,
    });

    // Register business
    const regRes = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${oldToken}`)
      .send(sampleBusinessPayload);

    assert.strictEqual(regRes.statusCode, 201);
    const newToken = regRes.body.data.accessToken;
    assert.ok(newToken);

    // Old token must now be rejected by protect middleware
    const oldTokenRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);

    assert.strictEqual(oldTokenRes.statusCode, 401);
    assert.strictEqual(oldTokenRes.body.error.code, "TOKEN_REVOKED");

    // New token must succeed and reflect provider role
    const newTokenRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${newToken}`);

    assert.strictEqual(newTokenRes.statusCode, 200);
    assert.strictEqual(newTokenRes.body.data.user.role, "provider");

    // New token must allow access to provider-restricted GET /businesses/my/list
    const myListRes = await request(app)
      .get("/api/v1/businesses/my/list")
      .set("Authorization", `Bearer ${newToken}`);

    assert.strictEqual(myListRes.statusCode, 200);
    assert.strictEqual(myListRes.body.data.businesses.length, 1);
  });

  // 3. Transaction Rollback Integrity
  it("3. Should roll back business creation and user role elevation if any step in transaction fails", async () => {
    const { user, token } = await createTestUser({
      name: "Charlie Brown",
      email: "charlie@example.com",
      role: "customer",
      tokenVersion: 0,
    });

    // Temporarily mock Business.create to simulate unexpected database failure inside transaction
    const originalBusinessCreate = Business.create;
    Business.create = async () => {
      throw new Error("Simulated database write failure during business creation");
    };

    try {
      const res = await request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${token}`)
        .send(sampleBusinessPayload);

      assert.strictEqual(res.statusCode, 500);
    } finally {
      Business.create = originalBusinessCreate;
    }

    // Verify complete rollback in database:
    const bizCount = await Business.countDocuments({ ownerId: user._id });
    assert.strictEqual(bizCount, 0, "Business must not be persisted on transaction failure");

    // User role & tokenVersion remained untouched
    const dbUser = await User.findById(user._id);
    assert.strictEqual(dbUser.role, "customer", "User role must not be elevated on rollback");
    assert.strictEqual(dbUser.tokenVersion, 0, "tokenVersion must not be incremented on rollback");

    // Customer's original token is still valid
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(meRes.statusCode, 200);
  });

  // 4. Multiple Business Venues for Existing Provider
  it("4. Should allow existing provider to register additional venues without bumping tokenVersion or invalidating sessions", async () => {
    const { user, token: providerToken } = await createTestUser({
      name: "Dan Provider",
      email: "dan@example.com",
      role: "provider",
      tokenVersion: 5,
    });

    // Register Venue 1
    const res1 = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ ...sampleBusinessPayload, name: "Venue Alpha" });
    assert.strictEqual(res1.statusCode, 201);
    assert.strictEqual(res1.body.data.accessToken, null, "Existing provider does not require a new token");

    // Register Venue 2
    const res2 = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${providerToken}`)
      .send({ ...sampleBusinessPayload, name: "Venue Beta" });
    assert.strictEqual(res2.statusCode, 201);

    // Verify tokenVersion remained 5 (no session disruption)
    const dbUser = await User.findById(user._id);
    assert.strictEqual(dbUser.tokenVersion, 5);
    assert.strictEqual(dbUser.role, "provider");

    // List businesses for Dan
    const listRes = await request(app)
      .get("/api/v1/businesses/my/list")
      .set("Authorization", `Bearer ${providerToken}`);

    assert.strictEqual(listRes.statusCode, 200);
    assert.strictEqual(listRes.body.data.businesses.length, 2);
  });

  // 5. Direct Ownership Authorization & Cross-Business IDOR Defense
  it("5. Should block cross-business IDOR: Provider A cannot access Provider B's business venue", async () => {
    const { token: tokenA } = await createTestUser({
      name: "Owner A",
      email: "ownerA@example.com",
      role: "provider",
      tokenVersion: 1,
    });

    const { token: tokenB } = await createTestUser({
      name: "Owner B",
      email: "ownerB@example.com",
      role: "provider",
      tokenVersion: 1,
    });

    // Create Business A
    const resA = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ ...sampleBusinessPayload, name: "Business A" });
    const bizAId = resA.body.data.business._id;

    // Create Business B
    const resB = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ ...sampleBusinessPayload, name: "Business B" });
    const bizBId = resB.body.data.business._id;

    // Owner A attempts to access Business B via manipulated businessId parameter
    const idorRes = await request(app)
      .get(`/api/v1/businesses/${bizBId}/verify-access`)
      .set("Authorization", `Bearer ${tokenA}`);

    assert.strictEqual(idorRes.statusCode, 403);
    assert.strictEqual(idorRes.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");

    // Owner B attempts to access Business A
    const idorRes2 = await request(app)
      .get(`/api/v1/businesses/${bizAId}/verify-access`)
      .set("Authorization", `Bearer ${tokenB}`);

    assert.strictEqual(idorRes2.statusCode, 403);
    assert.strictEqual(idorRes2.body.error.code, "FORBIDDEN_BUSINESS_ACCESS");

    // Owner A accesses Business A -> Succeeded
    const legitRes = await request(app)
      .get(`/api/v1/businesses/${bizAId}/verify-access`)
      .set("Authorization", `Bearer ${tokenA}`);

    assert.strictEqual(legitRes.statusCode, 200);
    assert.strictEqual(legitRes.body.data.business.name, "Business A");
    assert.strictEqual(legitRes.body.data.isPlatformAdmin, false);
  });

  // 6. Explicit Platform Admin Access
  it("6. Should allow platform admin explicit access to any business venue", async () => {
    const { token: providerToken } = await createTestUser({
      name: "Provider Venue",
      email: "venue@example.com",
      role: "provider",
      tokenVersion: 1,
    });

    const { token: adminToken } = await createTestUser({
      name: "Super Admin",
      email: "admin@waitless.com",
      role: "admin",
      tokenVersion: 1,
    });

    const regRes = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${providerToken}`)
      .send(sampleBusinessPayload);
    const businessId = regRes.body.data.business._id;

    // Admin accesses scoped business endpoint directly
    const adminRes = await request(app)
      .get(`/api/v1/businesses/${businessId}/verify-access`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(adminRes.statusCode, 200);
    assert.strictEqual(adminRes.body.data.isPlatformAdmin, true);

    // Admin accessing a non-existent business returns 404
    const fakeId = new mongoose.Types.ObjectId();
    const notFoundRes = await request(app)
      .get(`/api/v1/businesses/${fakeId}/verify-access`)
      .set("Authorization", `Bearer ${adminToken}`);

    assert.strictEqual(notFoundRes.statusCode, 404);
    assert.strictEqual(notFoundRes.body.error.code, "BUSINESS_NOT_FOUND");
  });

  // 7. Suspended & Deactivated Business Protection
  it("7. Should block owner from deactivated or suspended businesses while retaining admin access", async () => {
    const { token: ownerToken } = await createTestUser({
      name: "Owner Suspended",
      email: "ownersus@example.com",
      role: "provider",
      tokenVersion: 1,
    });

    const { token: adminToken } = await createTestUser({
      name: "Admin Oversight",
      email: "adminover@example.com",
      role: "admin",
      tokenVersion: 1,
    });

    const regRes = await request(app)
      .post("/api/v1/businesses/register")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(sampleBusinessPayload);
    const businessId = regRes.body.data.business._id;

    // Case 1: Deactivated business
    await Business.findByIdAndUpdate(businessId, { isActive: false });

    const deactRes = await request(app)
      .get(`/api/v1/businesses/${businessId}/verify-access`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(deactRes.statusCode, 403);
    assert.strictEqual(deactRes.body.error.code, "BUSINESS_DEACTIVATED");

    // Case 2: Suspended business
    await Business.findByIdAndUpdate(businessId, { isActive: true, approvalStatus: "suspended" });

    const suspRes = await request(app)
      .get(`/api/v1/businesses/${businessId}/verify-access`)
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.strictEqual(suspRes.statusCode, 403);
    assert.strictEqual(suspRes.body.error.code, "BUSINESS_SUSPENDED");

    // Platform admin still retains access for investigation
    const adminRes = await request(app)
      .get(`/api/v1/businesses/${businessId}/verify-access`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.strictEqual(adminRes.statusCode, 200);
    assert.strictEqual(adminRes.body.data.isPlatformAdmin, true);
  });

  // 8. Concurrent Business Registration
  it("8. Should safely handle concurrent business registration requests without corrupting state", async () => {
    const { token: custToken } = await createTestUser({
      name: "Concurrent Frank",
      email: "frank@example.com",
      role: "customer",
      tokenVersion: 0,
    });

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ ...sampleBusinessPayload, name: "Concurrent Branch 1" }),
      request(app)
        .post("/api/v1/businesses/register")
        .set("Authorization", `Bearer ${custToken}`)
        .send({ ...sampleBusinessPayload, name: "Concurrent Branch 2" }),
    ]);

    // Both requests must succeed cleanly
    assert.strictEqual(res1.statusCode, 201);
    assert.strictEqual(res2.statusCode, 201);

    // Verify 2 distinct businesses created with proper ownerId
    const businesses = await Business.find({ name: /Concurrent Branch/ });
    assert.strictEqual(businesses.length, 2);
  });

  // 9. Audit & Safe Migration of Legacy Global Staff Users
  it("9. Should safely migrate legacy users with global role: 'staff' to role: 'customer'", async () => {
    const legacyUser = await User.create({
      name: "Legacy Staff Guy",
      email: "legacy@example.com",
      passwordHash: "$2a$12$e8vK1N1/wD7C4oA8f.W.eeM6h6PqvR7h7D8e8w9f0g1h2i3j4k5l6",
      role: "staff",
      tokenVersion: 0,
    });

    assert.strictEqual(legacyUser.role, "staff");

    // Execute safe migration
    const migrationResult = await migrateLegacyStaffRoles();
    assert.strictEqual(migrationResult.modifiedCount, 1);

    // Database verification
    const migratedUser = await User.findById(legacyUser._id);
    assert.strictEqual(migratedUser.role, "customer");
  });

  // 10. Migration Database Failure Handling
  it("10. Should handle database failure during legacy role migration by logging and propagating error", async () => {
    const originalUpdateMany = User.updateMany;
    User.updateMany = async () => {
      throw new Error("Simulated database failure during migration");
    };

    try {
      await assert.rejects(
        async () => {
          await migrateLegacyStaffRoles();
        },
        {
          message: "Simulated database failure during migration",
        }
      );
    } finally {
      User.updateMany = originalUpdateMany;
    }
  });

  // 11. Missing Authentication Rejection
  it("11. Should reject unauthenticated requests to business endpoints with 401 TOKEN_MISSING", async () => {
    // 1. POST /register
    const regRes = await request(app)
      .post("/api/v1/businesses/register")
      .send(sampleBusinessPayload);
    assert.strictEqual(regRes.statusCode, 401);
    assert.strictEqual(regRes.body.error.code, "TOKEN_MISSING");

    // 2. GET /my/list
    const listRes = await request(app)
      .get("/api/v1/businesses/my/list");
    assert.strictEqual(listRes.statusCode, 401);
    assert.strictEqual(listRes.body.error.code, "TOKEN_MISSING");

    // 3. Scoped route
    const fakeId = new mongoose.Types.ObjectId();
    const scopedRes = await request(app)
      .get(`/api/v1/businesses/${fakeId}/verify-access`);
    assert.strictEqual(scopedRes.statusCode, 401);
    assert.strictEqual(scopedRes.body.error.code, "TOKEN_MISSING");
  });

  // 12. Invalid Business ID Syntax Rejection
  it("12. Should reject invalid businessId syntax with 400 INVALID_BUSINESS_ID", async () => {
    const { token } = await createTestUser({
      name: "Valid User",
      email: "validuser@example.com",
      role: "provider",
      tokenVersion: 1,
    });

    const res = await request(app)
      .get("/api/v1/businesses/not-a-valid-mongo-id-12345/verify-access")
      .set("Authorization", `Bearer ${token}`);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error.code, "INVALID_BUSINESS_ID");
  });

  // 13. Customer Rejection from Provider-Only Business Listing
  it("13. Should reject customer role from GET /businesses/my/list with 403 FORBIDDEN", async () => {
    const { token: customerToken } = await createTestUser({
      name: "Regular Customer",
      email: "customeronly@example.com",
      role: "customer",
      tokenVersion: 0,
    });

    const res = await request(app)
      .get("/api/v1/businesses/my/list")
      .set("Authorization", `Bearer ${customerToken}`);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.error.code, "FORBIDDEN");
  });

  // 14. Production Configuration Refinement Rejection
  it("14. Should enforce that DEFAULT_BUSINESS_APPROVAL_STATUS cannot be 'approved' in production", () => {
    const baseConfig = {
      PORT: "5000",
      MONGO_URI: "mongodb://localhost:27017/waitless_test",
      FRONTEND_URL: "http://localhost:5173",
      CORS_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "info",
      JWT_ACCESS_SECRET: "test_jwt_access_secret_key_minimum_32_characters_long_for_security",
      JWT_REFRESH_SECRET: "test_jwt_refresh_secret_key_minimum_32_characters_long_for_security",
      JWT_ACCESS_EXPIRATION: "15m",
      JWT_REFRESH_EXPIRATION_DAYS: "7",
      COOKIE_SAME_SITE: "lax",
      COOKIE_SECURE: "false",
      COOKIE_PATH: "/api/v1/auth",
      TRUST_PROXY: "false",
    };

    // Case 1: In production, DEFAULT_BUSINESS_APPROVAL_STATUS=approved must fail schema validation
    const invalidProd = env.envSchema.safeParse({
      ...baseConfig,
      NODE_ENV: "production",
      DEFAULT_BUSINESS_APPROVAL_STATUS: "approved",
    });
    assert.strictEqual(invalidProd.success, false);
    const issues = invalidProd.error.issues || invalidProd.error.errors;
    assert.ok(
      issues.some(
        (e) =>
          e.path.includes("DEFAULT_BUSINESS_APPROVAL_STATUS") &&
          e.message.includes("cannot be 'approved' in production")
      )
    );

    // Case 2: In production, DEFAULT_BUSINESS_APPROVAL_STATUS=pending must succeed
    const validProd = env.envSchema.safeParse({
      ...baseConfig,
      NODE_ENV: "production",
      DEFAULT_BUSINESS_APPROVAL_STATUS: "pending",
    });
    assert.strictEqual(validProd.success, true);
    assert.strictEqual(validProd.data.DEFAULT_BUSINESS_APPROVAL_STATUS, "pending");
  });
});

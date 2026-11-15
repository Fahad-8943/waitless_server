const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Set environment for test mode before loading app
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test_jwt_access_secret_key_minimum_32_characters_long_for_security";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret_key_minimum_32_characters_long_for_security";
process.env.COOKIE_SAME_SITE = "lax";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_PATH = "/api/v1/auth";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.CORS_ORIGIN = "http://localhost:5173";

const app = require("../../src/app");
const v1Router = require("../../src/routes/v1");
const User = require("../../src/models/User");
const RefreshToken = require("../../src/models/RefreshToken");
const { authorize, protect } = require("../../src/middleware/auth");
const ApiResponse = require("../../src/utils/apiResponse");

// Attach a test-only RBAC endpoint to v1Router for RBAC verification
v1Router.get(
  "/test-provider-only",
  protect,
  authorize("provider", "admin"),
  (req, res) => {
    return ApiResponse.ok(res, "Provider access granted", { user: req.user });
  }
);

let replSet;

describe("Phase 2 — Authentication & Authorization Integration Tests", () => {
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
    await RefreshToken.deleteMany({});
  });

  // 1. Registration & Privilege Escalation Prevention
  it("1. Should strictly enforce customer role and prevent privilege escalation during public registration", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Alice Doe",
        email: "alice@example.com",
        phone: "+919876543201",
        password: "ValidPassword123!",
        role: "admin", // Malicious privilege escalation attempt
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.role, "customer"); // Must be customer!
    assert.strictEqual(res.body.data.user.passwordHash, undefined); // Zero leakage
    assert.ok(res.body.data.accessToken);

    // Verify cookie attributes
    const cookieHeader = res.headers["set-cookie"];
    assert.ok(cookieHeader, "Refresh cookie must be present");
    const cookieStr = cookieHeader[0];
    assert.ok(cookieStr.includes("Path=/api/v1/auth"));
    assert.ok(cookieStr.includes("HttpOnly"));

    // Database verification
    const dbUser = await User.findOne({ email: "alice@example.com" }).select("+passwordHash");
    assert.ok(dbUser);
    assert.strictEqual(dbUser.role, "customer");
    assert.strictEqual(dbUser.tokenVersion, 0);
    assert.strictEqual(dbUser.isEmailVerified, false);
    assert.strictEqual(dbUser.isPhoneVerified, false);
    assert.ok(dbUser.passwordHash.startsWith("$2")); // Valid bcrypt hash
  });

  // 2. Bcrypt 72-Byte Boundary Validation
  it("2. Should enforce bcrypt 72-byte UTF-8 ceiling without silent truncation", async () => {
    // 73 bytes ASCII
    const longPassword73 = "A".repeat(70) + "1!a";
    assert.strictEqual(Buffer.byteLength(longPassword73, "utf8"), 73);

    const failRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Long Pass User",
        email: "longpass@example.com",
        password: longPassword73,
      });

    assert.strictEqual(failRes.status, 400);
    assert.strictEqual(failRes.body.success, false);
    assert.strictEqual(failRes.body.error.code, "VALIDATION_ERROR");

    // 72 bytes ASCII (exactly on boundary)
    const exactPassword72 = "A".repeat(69) + "1!a";
    assert.strictEqual(Buffer.byteLength(exactPassword72, "utf8"), 72);

    const successRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Boundary Pass User",
        email: "exactpass@example.com",
        password: exactPassword72,
      });

    assert.strictEqual(successRes.status, 201);
  });

  // 3. Partial Unique Indexes for Email and Phone
  it("3. Should allow multiple users with null email and unique phone without duplicate key collision", async () => {
    const user1 = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Phone User One",
        phone: "+919876543211",
        password: "ValidPassword123!",
      });
    assert.strictEqual(user1.status, 201);

    const user2 = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Phone User Two",
        phone: "+919876543212",
        password: "ValidPassword123!",
      });
    assert.strictEqual(user2.status, 201);

    // Verify both exist in DB with email: null
    const countNullEmail = await User.countDocuments({ email: null });
    assert.strictEqual(countNullEmail, 2);

    // Duplicate phone must be rejected
    const dupPhone = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Phone User Duplicate",
        phone: "+919876543211",
        password: "ValidPassword123!",
      });
    assert.strictEqual(dupPhone.status, 409);
    assert.strictEqual(dupPhone.body.error.code, "PHONE_EXISTS");
  });

  // 4. Authentication (Login) & Response Data Sanitization
  it("4. Should authenticate via email or phone and sanitize passwordHash in all responses", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Login User",
        email: "login@example.com",
        phone: "+919876543220",
        password: "ValidPassword123!",
      });

    // Login via email
    const emailLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "login@example.com",
        password: "ValidPassword123!",
      });
    assert.strictEqual(emailLogin.status, 200);
    assert.strictEqual(emailLogin.body.data.user.passwordHash, undefined);
    assert.ok(emailLogin.body.data.accessToken);

    // Login via phone
    const phoneLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "+919876543220",
        password: "ValidPassword123!",
      });
    assert.strictEqual(phoneLogin.status, 200);

    // Invalid password
    const failLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "login@example.com",
        password: "WrongPassword999!",
      });
    assert.strictEqual(failLogin.status, 401);
    assert.strictEqual(failLogin.body.error.code, "INVALID_CREDENTIALS");
  });

  // 5. Multi-Session Isolation (Device A vs Device B)
  it("5. Should support multiple concurrent sessions and isolate single-session logouts", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Multi Device User",
        email: "multidevice@example.com",
        password: "ValidPassword123!",
      });

    // Session 1: Device A (e.g. Laptop)
    const loginA = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "multidevice@example.com",
        password: "ValidPassword123!",
      });
    const cookieA = loginA.headers["set-cookie"][0].split(";")[0];

    // Session 2: Device B (e.g. Phone)
    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "multidevice@example.com",
        password: "ValidPassword123!",
      });
    const cookieB = loginB.headers["set-cookie"][0].split(";")[0];

    // Verify 3 tokens in DB (1 from register, 2 from logins) across 3 distinct families
    const tokens = await RefreshToken.find({});
    assert.strictEqual(tokens.length, 3);
    const familyIds = new Set(tokens.map((t) => t.familyId));
    assert.strictEqual(familyIds.size, 3);

    // Logout Device A
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieA)
      .set("x-waitless-client", "1");
    assert.strictEqual(logoutRes.status, 200);

    // Device B's session must remain active and rotate successfully
    const refreshB = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieB)
      .set("x-waitless-client", "1");
    assert.strictEqual(refreshB.status, 200);
    assert.ok(refreshB.body.data.accessToken);

    // Device A's session must be revoked
    const refreshA = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookieA)
      .set("x-waitless-client", "1");
    // Token was revoked via normal logout (revocationReason: 'LOGOUT'), so refresh is rejected
    assert.strictEqual(refreshA.status, 401);
  });

  // 6. Atomic Refresh-Token Rotation & Database State
  it("6. Should rotate refresh token atomically and update database state correctly", async () => {
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Rotate User",
        email: "rotate@example.com",
        password: "ValidPassword123!",
      });
    const initialCookie = regRes.headers["set-cookie"][0].split(";")[0];

    // Rotate token
    const rotateRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", initialCookie)
      .set("x-waitless-client", "1");

    assert.strictEqual(rotateRes.status, 200);
    assert.ok(rotateRes.body.data.accessToken);
    const newCookie = rotateRes.headers["set-cookie"][0].split(";")[0];
    assert.notStrictEqual(initialCookie, newCookie);

    // Database verification: Exactly 2 tokens in this family
    const allTokens = await RefreshToken.find({}).sort({ createdAt: 1 });
    assert.strictEqual(allTokens.length, 2);

    const oldToken = allTokens[0];
    const newToken = allTokens[1];

    assert.strictEqual(oldToken.isRevoked, true);
    assert.strictEqual(oldToken.revocationReason, "ROTATED");
    assert.strictEqual(oldToken.replacedByTokenHash, newToken.tokenHash);
    assert.strictEqual(newToken.isRevoked, false);
    assert.strictEqual(oldToken.familyId, newToken.familyId);
  });

  // 7. Concurrent Refresh Race: Single-Use Token Enforcement
  it("7. Should handle simultaneous concurrent refresh requests: exactly one succeeds, loser gets no credentials, exactly one replacement token exists", async () => {
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Concurrent User",
        email: "concurrent@example.com",
        password: "ValidPassword123!",
      });
    const cookie = regRes.headers["set-cookie"][0].split(";")[0];

    // Fire two simultaneous requests with the exact same cookie
    const [res1, res2] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").set("Cookie", cookie).set("x-waitless-client", "1"),
      request(app).post("/api/v1/auth/refresh").set("Cookie", cookie).set("x-waitless-client", "1"),
    ]);

    // Exactly one must succeed (200 OK) and exactly one must fail (409 Conflict)
    const winningRes = res1.status === 200 ? res1 : res2;
    const losingRes = res1.status === 200 ? res2 : res1;

    // Winner receives replacement refresh token and new access token
    assert.strictEqual(winningRes.status, 200);
    assert.ok(winningRes.body.data.accessToken);
    assert.ok(winningRes.headers["set-cookie"], "Winner receives new refresh token cookie");

    // The losing request receives NO new credentials
    assert.strictEqual(losingRes.status, 409);
    assert.strictEqual(losingRes.body.error.code, "CONCURRENT_REFRESH_RACE");
    assert.strictEqual(losingRes.body.data, undefined);
    assert.strictEqual(losingRes.headers["set-cookie"], undefined, "Loser must NOT receive any refresh token cookie");

    // Database verification: Exactly one active replacement refresh token exists
    const activeTokens = await RefreshToken.find({ isRevoked: false });
    assert.strictEqual(activeTokens.length, 1);
  });

  // 8. Genuine Token Reuse & User-Wide Global Revocation (with Cross-User Isolation)
  it("8. Should detect genuine token reuse, trigger user-wide session revocation, and leave other users unaffected", async () => {
    // User 1: Victim
    const regRes1 = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Theft User",
        email: "theft@example.com",
        password: "ValidPassword123!",
      });
    const user1Cookie1 = regRes1.headers["set-cookie"][0].split(";")[0];

    // User 1: Second active session on Device B (Family 2)
    const loginRes1B = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "theft@example.com",
        password: "ValidPassword123!",
      });
    const user1CookieB = loginRes1B.headers["set-cookie"][0].split(";")[0];

    // User 2: Completely independent user
    const regRes2 = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Other User",
        email: "other@example.com",
        password: "ValidPassword123!",
      });
    const user2AccessToken = regRes2.body.data.accessToken;
    const user2Cookie = regRes2.headers["set-cookie"][0].split(";")[0];

    // Rotate User 1's Device A token once -> produces replacement token
    const rotRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", user1Cookie1)
      .set("x-waitless-client", "1");
    assert.strictEqual(rotRes.status, 200);

    // Artificially age the revoked token past the 5s concurrency window to simulate true later replay attack
    await RefreshToken.updateOne(
      { isRevoked: true },
      { $set: { revokedAt: new Date(Date.now() - 10000) } } // 10 seconds ago (outside 5s window)
    );

    // Attacker reuses original rotated token later!
    const reuseRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", user1Cookie1)
      .set("x-waitless-client", "1");

    assert.strictEqual(reuseRes.status, 401);
    assert.strictEqual(reuseRes.body.error.code, "REVOKED_TOKEN_REUSE");

    // Database verification: User 1 has ZERO active refresh tokens across ALL families
    const user1ActiveTokens = await RefreshToken.countDocuments({
      userId: regRes1.body.data.user._id,
      isRevoked: false,
    });
    assert.strictEqual(user1ActiveTokens, 0);

    // User 1's tokenVersion must be incremented
    const user1 = await User.findById(regRes1.body.data.user._id);
    assert.strictEqual(user1.tokenVersion, 1);

    // User 2 must be COMPLETELY UNAFFECTED
    const user2 = await User.findById(regRes2.body.data.user._id);
    assert.strictEqual(user2.tokenVersion, 0);

    const user2ActiveTokens = await RefreshToken.countDocuments({
      userId: regRes2.body.data.user._id,
      isRevoked: false,
    });
    assert.strictEqual(user2ActiveTokens, 1);

    // User 2's session continues to work seamlessly
    const user2MeRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${user2AccessToken}`);
    assert.strictEqual(user2MeRes.status, 200);

    const user2RefreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", user2Cookie)
      .set("x-waitless-client", "1");
    assert.strictEqual(user2RefreshRes.status, 200);
  });

  // 9. Global Session Revocation via /logout-all
  it("9. Should globally revoke active sessions and reject old access tokens after logout-all", async () => {
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Logout All User",
        email: "logoutall@example.com",
        password: "ValidPassword123!",
      });
    const accessToken = regRes.body.data.accessToken;

    // Access /me succeeds initially
    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.strictEqual(meRes.status, 200);

    // Call /logout-all
    const logoutAllRes = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.strictEqual(logoutAllRes.status, 200);

    // Database verification
    const activeTokens = await RefreshToken.countDocuments({ isRevoked: false });
    assert.strictEqual(activeTokens, 0);

    const user = await User.findOne({ email: "logoutall@example.com" });
    assert.strictEqual(user.tokenVersion, 1);

    // Old access token must now be rejected with 401 TOKEN_REVOKED
    const rejectedMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.strictEqual(rejectedMe.status, 401);
    assert.strictEqual(rejectedMe.body.error.code, "TOKEN_REVOKED");
  });

  // 10. RBAC Authorization Guard
  it("10. Should reject customer role from provider-restricted endpoints with 403 Forbidden", async () => {
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Customer User",
        email: "customer@example.com",
        password: "ValidPassword123!",
      });
    const customerToken = regRes.body.data.accessToken;

    // Customer attempts to access provider-only route
    const forbiddenRes = await request(app)
      .get("/api/v1/test-provider-only")
      .set("Authorization", `Bearer ${customerToken}`);

    assert.strictEqual(forbiddenRes.status, 403);
    assert.strictEqual(forbiddenRes.body.error.code, "FORBIDDEN");

    // Unauthenticated request returns 401
    const unauthRes = await request(app).get("/api/v1/test-provider-only");
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.error.code, "TOKEN_MISSING");
  });
});

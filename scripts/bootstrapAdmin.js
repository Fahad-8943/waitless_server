/**
 * WaitLess — Administrator Bootstrap Script
 *
 * Secure, idempotent, one-time administrator account creation.
 * Excluded from normal server startup; cannot be invoked through public APIs.
 *
 * Usage:
 *   ADMIN_EMAIL="admin@waitless.com" ADMIN_PASSWORD="YourStrongPassword123!" node scripts/bootstrapAdmin.js
 *
 * If credentials are not supplied via environment variables, the script prompts securely via terminal input.
 */

const readline = require("readline");
const mongoose = require("mongoose");
const env = require("../src/config/env");
const { connectDatabase, closeDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const authService = require("../src/services/authService");
const logger = require("../src/utils/logger");

const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
};

const validatePasswordComplexity = (password) => {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  if (password.length > 100) {
    throw new Error("Password cannot exceed 100 characters");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password cannot exceed 72 bytes (bcrypt ceiling)");
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    throw new Error("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    throw new Error("Password must contain at least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new Error("Password must contain at least one special character");
  }
};

const bootstrapAdmin = async () => {
  let email = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : null;
  let password = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD : null;
  const name = process.env.ADMIN_NAME ? process.env.ADMIN_NAME.trim() : "Platform Administrator";
  const phone = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.trim() : null;

  if (!email) {
    email = (await askQuestion("Enter Administrator Email: ")).trim().toLowerCase();
  }

  if (!email || !email.includes("@")) {
    throw new Error("A valid email address is required for administrator bootstrapping");
  }

  if (!password) {
    password = await askQuestion("Enter Administrator Password: ");
  }

  validatePasswordComplexity(password);

  console.log(`[BOOTSTRAP] Connecting to database...`);
  await connectDatabase(env.MONGO_URI);

  // Check if admin already exists (idempotency)
  const existingUser = await User.findOne({ email }).select("+passwordHash");

  let adminUser;
  if (existingUser) {
    if (existingUser.role === "admin") {
      console.log(`[BOOTSTRAP] Administrator account already exists for ${email} (ID: ${existingUser._id}).`);
      console.log(`[BOOTSTRAP] Preserving existing administrator credentials without modification.`);
      adminUser = existingUser;
    } else {
      throw new Error(
        `User account with email '${email}' already exists with role '${existingUser.role}'. Refusing to overwrite.`
      );
    }
  } else {
    // Check if another admin already exists
    const anyAdmin = await User.findOne({ role: "admin" });
    if (anyAdmin && !process.env.ALLOW_MULTIPLE_ADMINS) {
      console.log(`[BOOTSTRAP] An administrator account already exists on the platform (ID: ${anyAdmin._id}).`);
      console.log(`[BOOTSTRAP] To create an additional admin, set ALLOW_MULTIPLE_ADMINS=true.`);
      adminUser = anyAdmin;
    } else {
      console.log(`[BOOTSTRAP] Hashing password with bcrypt...`);
      const passwordHash = await authService.hashPassword(password);

      adminUser = await User.create({
        name,
        email,
        phone,
        passwordHash,
        role: "admin",
        isEmailVerified: true,
        isPhoneVerified: Boolean(phone),
        isActive: true,
      });

      console.log(`[BOOTSTRAP] Created new administrator account successfully:`);
      console.log(`  - User ID: ${adminUser._id}`);
      console.log(`  - Name:    ${adminUser.name}`);
      console.log(`  - Email:   ${adminUser.email}`);
      console.log(`  - Role:    ${adminUser.role}`);
    }
  }

  // Verification step: Authenticate and test admin-protected endpoint
  console.log(`[BOOTSTRAP] Verifying administrator authentication...`);
  try {
    const loginResult = await authService.loginUser({
      identifier: email,
      password,
      clientIp: "127.0.0.1",
    });

    console.log(`[BOOTSTRAP] Authentication test succeeded. Received JWT access token.`);
    console.log(`[BOOTSTRAP] Verifying access to admin-protected endpoint (GET /api/v1/admin/stats)...`);

    const supertest = require("supertest");
    const app = require("../src/app");

    const statsRes = await supertest(app)
      .get("/api/v1/admin/stats")
      .set("Authorization", `Bearer ${loginResult.accessToken}`);

    if (statsRes.status === 200 && statsRes.body.success) {
      console.log(`[BOOTSTRAP] Admin verification PASSED. HTTP 200 OK received from /api/v1/admin/stats.`);
      console.log(`[BOOTSTRAP] Platform Users: ${statsRes.body.data.users.total}, Admins: ${statsRes.body.data.users.admins}`);
    } else {
      throw new Error(`Admin endpoint verification failed (HTTP ${statsRes.status}): ${JSON.stringify(statsRes.body)}`);
    }
  } catch (verifyErr) {
    if (existingUser && verifyErr.message.includes("Invalid credentials provided")) {
      console.log(`[BOOTSTRAP] Note: Existing admin credentials differ from the provided password. Preserved original.`);
    } else {
      throw verifyErr;
    }
  }

  await closeDatabase();
  console.log(`[BOOTSTRAP] Administrator bootstrap completed successfully.`);
};

if (require.main === module) {
  bootstrapAdmin()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`[BOOTSTRAP ERROR] ${err.message}`);
      try {
        await closeDatabase();
      } catch (_) {}
      process.exit(1);
    });
}

module.exports = bootstrapAdmin;

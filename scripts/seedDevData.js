/**
 * WaitLess — Development Data Seed Script
 *
 * Populates the MongoDB database with realistic, fictional development seed data.
 * Safe, idempotent, and non-destructive: Re-running this script will never create
 * duplicate users, businesses, services, bookings, or queue entries.
 *
 * Usage:
 *   node scripts/seedDevData.js
 */

const mongoose = require("mongoose");
const env = require("../src/config/env");
const { connectDatabase, closeDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const Business = require("../src/models/Business");
const Service = require("../src/models/Service");
const Booking = require("../src/models/Booking");
const QueueEntry = require("../src/models/QueueEntry");
const { hashPassword } = require("../src/services/authService");
const { getLocalBusinessDateString } = require("../src/utils/timezone");

const SEED_PASSWORD = process.env.DEV_SEED_PASSWORD || "WaitLess@Dev2026!";

async function seedDevelopmentData() {
  console.log(`[SEED] Connecting to database...`);
  await connectDatabase(env.MONGO_URI);

  const sharedPasswordHash = await hashPassword(SEED_PASSWORD);

  // ==========================================
  // 1. Verify or Bootstrap Administrator
  // ==========================================
  console.log(`[SEED] 1/5 Checking Platform Administrator...`);
  let admin = await User.findOne({ role: "admin" });
  if (!admin) {
    console.log(`[SEED] No admin found. Bootstrapping default dev admin...`);
    admin = await User.create({
      name: "Platform Administrator [Dev]",
      email: "admin@waitless.com",
      phone: "+919999900000",
      passwordHash: sharedPasswordHash,
      role: "admin",
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });
    console.log(`[SEED] Created admin: ${admin.email}`);
  } else {
    console.log(`[SEED] Existing admin verified: ${admin.email} (ID: ${admin._id})`);
  }

  // ==========================================
  // 2. Seed Provider and Customer Accounts
  // ==========================================
  console.log(`[SEED] 2/5 Seeding Provider and Customer Accounts...`);

  const usersToSeed = [
    // Providers
    {
      name: "Alice Vance [Dev Provider]",
      email: "provider.alice@waitless.dev",
      phone: "+919876543210",
      role: "provider",
    },
    {
      name: "Bob Builder [Dev Provider]",
      email: "provider.bob@waitless.dev",
      phone: "+919876543211",
      role: "provider",
    },
    // Customers
    {
      name: "Charlie Customer [Dev]",
      email: "customer.charlie@waitless.dev",
      phone: "+919876543220",
      role: "customer",
    },
    {
      name: "Diana Customer [Dev]",
      email: "customer.diana@waitless.dev",
      phone: "+919876543221",
      role: "customer",
    },
    {
      name: "Evan Customer [Dev]",
      email: "customer.evan@waitless.dev",
      phone: "+919876543222",
      role: "customer",
    },
  ];

  const userMap = {};
  for (const u of usersToSeed) {
    let user = await User.findOne({ email: u.email });
    if (!user) {
      user = await User.create({
        name: u.name,
        email: u.email,
        phone: u.phone,
        passwordHash: sharedPasswordHash,
        role: u.role,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
      });
      console.log(`[SEED]   + Created ${u.role}: ${u.email}`);
    } else {
      console.log(`[SEED]   = Existing ${u.role}: ${u.email}`);
    }
    userMap[u.email] = user;
  }

  // ==========================================
  // 3. Seed Businesses
  // ==========================================
  console.log(`[SEED] 3/5 Seeding Sample Businesses...`);

  const businessesToSeed = [
    {
      key: "apex-salon",
      ownerId: userMap["provider.alice@waitless.dev"]._id,
      name: "Apex Hair & Beard Studio [Dev]",
      category: "Barbers & Salons",
      description: "Premier local grooming studio offering classic haircuts, beard sculpting, and real-time walk-in queue tracking.",
      contact: {
        email: "contact@apexsalon.waitless.dev",
        phone: "+918023456789",
      },
      address: {
        street: "428 Market Promenade, 1st Floor",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
      location: {
        type: "Point",
        coordinates: [77.5946, 12.9716], // [longitude, latitude]
      },
      timezone: "Asia/Kolkata",
      operatingHours: [
        { dayOfWeek: 1, openTime: "09:00", closeTime: "20:00", isClosed: false },
        { dayOfWeek: 2, openTime: "09:00", closeTime: "20:00", isClosed: false },
        { dayOfWeek: 3, openTime: "09:00", closeTime: "20:00", isClosed: false },
        { dayOfWeek: 4, openTime: "09:00", closeTime: "20:00", isClosed: false },
        { dayOfWeek: 5, openTime: "09:00", closeTime: "20:00", isClosed: false },
        { dayOfWeek: 6, openTime: "09:00", closeTime: "21:00", isClosed: false },
        { dayOfWeek: 0, openTime: "10:00", closeTime: "17:00", isClosed: true }, // Sunday closed
      ],
      policies: {
        maxQueueCapacity: 25,
        remoteQueueEnabled: true,
        gracePeriodMinutes: 10,
      },
      approvalStatus: "approved",
      isActive: true,
    },
    {
      key: "zenith-therapy",
      ownerId: userMap["provider.alice@waitless.dev"]._id,
      name: "Zenith Physical Therapy & Recovery [Dev]",
      category: "Fitness & Physical Therapy",
      description: "Dedicated sports rehab and physical therapy center offering targeted movement assessments and deep tissue recovery.",
      contact: {
        email: "care@zeniththerapy.waitless.dev",
        phone: "+918034567890",
      },
      address: {
        street: "12 Indiranagar 100ft Road",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560038",
        country: "IN",
      },
      location: {
        type: "Point",
        coordinates: [77.6412, 12.9784],
      },
      timezone: "Asia/Kolkata",
      operatingHours: [
        { dayOfWeek: 1, openTime: "08:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 2, openTime: "08:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 3, openTime: "08:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 4, openTime: "08:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 5, openTime: "08:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 6, openTime: "09:00", closeTime: "14:00", isClosed: false },
        { dayOfWeek: 0, openTime: "09:00", closeTime: "13:00", isClosed: true },
      ],
      policies: {
        maxQueueCapacity: 15,
        remoteQueueEnabled: true,
        gracePeriodMinutes: 15,
      },
      approvalStatus: "approved",
      isActive: true,
    },
    {
      key: "swift-motors",
      ownerId: userMap["provider.bob@waitless.dev"]._id,
      name: "Swift Motors Quick Service [Dev]",
      category: "Auto Service & Repair",
      description: "Express automotive repair garage awaiting platform moderation. Fast-lane oil changes and scheduled diagnostics.",
      contact: {
        email: "service@swiftmotors.waitless.dev",
        phone: "+918045678901",
      },
      address: {
        street: "88 Peenya Industrial Area, Phase 2",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560058",
        country: "IN",
      },
      location: {
        type: "Point",
        coordinates: [77.5123, 13.0234],
      },
      timezone: "Asia/Kolkata",
      operatingHours: [
        { dayOfWeek: 1, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 2, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 3, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 4, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 5, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 6, openTime: "09:30", closeTime: "18:30", isClosed: false },
        { dayOfWeek: 0, openTime: "10:00", closeTime: "14:00", isClosed: true },
      ],
      policies: {
        maxQueueCapacity: 10,
        remoteQueueEnabled: false,
        gracePeriodMinutes: 10,
      },
      approvalStatus: "pending", // Intentionally pending moderation
      isActive: true,
    },
  ];

  const businessMap = {};
  for (const b of businessesToSeed) {
    let biz = await Business.findOne({ name: b.name, ownerId: b.ownerId });
    if (!biz) {
      biz = await Business.create({
        name: b.name,
        category: b.category,
        description: b.description,
        contact: b.contact,
        address: b.address,
        location: b.location,
        timezone: b.timezone,
        operatingHours: b.operatingHours,
        policies: b.policies,
        ownerId: b.ownerId,
        approvalStatus: b.approvalStatus,
        isActive: b.isActive,
      });
      console.log(`[SEED]   + Created business: "${biz.name}" (Status: ${biz.approvalStatus})`);
    } else {
      console.log(`[SEED]   = Existing business: "${biz.name}"`);
    }
    businessMap[b.key] = biz;
  }

  // ==========================================
  // 4. Seed Services
  // ==========================================
  console.log(`[SEED] 4/5 Seeding Services for Each Business...`);

  const servicesToSeed = [
    // Apex Salon
    {
      businessKey: "apex-salon",
      name: "Classic Men's Haircut",
      description: "Precision clipper and shear haircut with hot lather neck shave and styling.",
      price: 350,
      duration: 30,
      isActive: true,
    },
    {
      businessKey: "apex-salon",
      name: "Beard Trim & Sculpt",
      description: "Beard shaping, straight-razor cheek line cleanup, and conditioning beard oil.",
      price: 200,
      duration: 20,
      isActive: true,
    },
    {
      businessKey: "apex-salon",
      name: "Royal Hot Towel Shave",
      description: "Traditional straight-edge razor hot towel lather shave with post-shave balm.",
      price: 450,
      duration: 25,
      isActive: true,
    },
    // Zenith Therapy
    {
      businessKey: "zenith-therapy",
      name: "Initial Comprehensive Assessment",
      description: "Full-body biomechanical assessment, movement screening, and customized rehab plan.",
      price: 800,
      duration: 45,
      isActive: true,
    },
    {
      businessKey: "zenith-therapy",
      name: "Targeted Manual Therapy Session",
      description: "Hands-on joint mobilization, soft tissue release, and assisted stretching.",
      price: 650,
      duration: 30,
      isActive: true,
    },
    // Swift Motors
    {
      businessKey: "swift-motors",
      name: "Synthetic Oil & Filter Service",
      description: "Full synthetic engine oil replacement, oil filter swap, and multi-point safety check.",
      price: 1200,
      duration: 60,
      isActive: true,
    },
    {
      businessKey: "swift-motors",
      name: "Brake Pad Inspection & Cleaning",
      description: "Front and rear brake pad measurement, caliper cleaning, and fluid level inspection.",
      price: 500,
      duration: 40,
      isActive: true,
    },
  ];

  const serviceMap = {};
  for (const s of servicesToSeed) {
    const businessId = businessMap[s.businessKey]._id;
    let svc = await Service.findOne({ businessId, name: s.name });
    if (!svc) {
      svc = await Service.create({
        businessId,
        name: s.name,
        description: s.description,
        price: s.price,
        duration: s.duration,
        isActive: s.isActive,
      });
      console.log(`[SEED]   + Created service: "${svc.name}" (₹${svc.price}, ${svc.duration}m)`);
    } else {
      console.log(`[SEED]   = Existing service: "${svc.name}"`);
    }
    serviceMap[`${s.businessKey}:${s.name}`] = svc;
  }

  // ==========================================
  // 5. Seed Bookings and Walk-in Queue Entries
  // ==========================================
  console.log(`[SEED] 5/5 Seeding Bookings and Walk-in Queue Entries...`);

  // Future booking dates
  const tomorrowMorning = new Date();
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(10, 30, 0, 0);

  const tomorrowAfternoon = new Date();
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(14, 0, 0, 0);

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 3);
  pastDate.setHours(11, 0, 0, 0);

  const apexBiz = businessMap["apex-salon"];
  const zenithBiz = businessMap["zenith-therapy"];

  const haircutSvc = serviceMap["apex-salon:Classic Men's Haircut"];
  const shaveSvc = serviceMap["apex-salon:Royal Hot Towel Shave"];
  const therapySvc = serviceMap["zenith-therapy:Initial Comprehensive Assessment"];

  const charlie = userMap["customer.charlie@waitless.dev"];
  const diana = userMap["customer.diana@waitless.dev"];
  const evan = userMap["customer.evan@waitless.dev"];

  const bookingsToSeed = [
    {
      businessId: apexBiz._id,
      customerId: charlie._id,
      serviceId: haircutSvc._id,
      serviceSnapshot: {
        serviceId: haircutSvc._id,
        name: haircutSvc.name,
        price: haircutSvc.price,
        duration: haircutSvc.duration,
      },
      bookingDate: tomorrowMorning,
      status: "pending",
      notes: "First time visit, prefer scissor cut on top.",
    },
    {
      businessId: apexBiz._id,
      customerId: diana._id,
      serviceId: shaveSvc._id,
      serviceSnapshot: {
        serviceId: shaveSvc._id,
        name: shaveSvc.name,
        price: shaveSvc.price,
        duration: shaveSvc.duration,
      },
      bookingDate: tomorrowAfternoon,
      status: "confirmed",
      confirmedAt: new Date(),
      notes: "Appointment confirmed by provider.",
    },
    {
      businessId: zenithBiz._id,
      customerId: charlie._id,
      serviceId: therapySvc._id,
      serviceSnapshot: {
        serviceId: therapySvc._id,
        name: therapySvc.name,
        price: therapySvc.price,
        duration: therapySvc.duration,
      },
      bookingDate: pastDate,
      status: "completed",
      completedAt: new Date(pastDate.getTime() + 45 * 60 * 1000),
      notes: "Completed initial assessment session.",
    },
  ];

  for (const b of bookingsToSeed) {
    const existing = await Booking.findOne({
      businessId: b.businessId,
      customerId: b.customerId,
      bookingDate: b.bookingDate,
    });
    if (!existing) {
      const created = await Booking.create(b);
      console.log(`[SEED]   + Created booking for ${b.serviceSnapshot.name} (Status: ${created.status})`);
    } else {
      console.log(`[SEED]   = Existing booking for ${b.serviceSnapshot.name}`);
    }
  }

  // Walk-in Queue Entries for Apex Salon (today)
  const todayStr = getLocalBusinessDateString(new Date(), apexBiz.timezone);
  const beardSvc = serviceMap["apex-salon:Beard Trim & Sculpt"];

  const queueToSeed = [
    {
      businessId: apexBiz._id,
      customerId: evan._id,
      serviceId: haircutSvc._id,
      serviceSnapshot: {
        serviceId: haircutSvc._id,
        name: haircutSvc.name,
        price: haircutSvc.price,
        duration: haircutSvc.duration,
      },
      tokenNumber: 1,
      tokenDisplay: "Q-001",
      dateStr: todayStr,
      status: "called",
      notes: "Walk-in patron, currently in barber chair.",
      joinedAt: new Date(Date.now() - 25 * 60 * 1000),
      calledAt: new Date(Date.now() - 5 * 60 * 1000),
    },
    {
      businessId: apexBiz._id,
      customerId: diana._id,
      serviceId: beardSvc._id,
      serviceSnapshot: {
        serviceId: beardSvc._id,
        name: beardSvc.name,
        price: beardSvc.price,
        duration: beardSvc.duration,
      },
      tokenNumber: 2,
      tokenDisplay: "Q-002",
      dateStr: todayStr,
      status: "waiting",
      notes: "Waiting in lounge area.",
      joinedAt: new Date(Date.now() - 12 * 60 * 1000),
    },
  ];

  for (const q of queueToSeed) {
    const existing = await QueueEntry.findOne({
      businessId: q.businessId,
      dateStr: q.dateStr,
      customerId: q.customerId,
    });
    if (!existing) {
      const created = await QueueEntry.create(q);
      console.log(`[SEED]   + Created queue token #${created.tokenDisplay} for patron (Status: ${created.status})`);
    } else {
      console.log(`[SEED]   = Existing queue token #${existing.tokenDisplay}`);
    }
  }

  console.log(`[SEED] Development seeding completed successfully!`);
  await closeDatabase();
}

if (require.main === module) {
  seedDevelopmentData()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`[SEED ERROR] ${err.message}`);
      try {
        await closeDatabase();
      } catch (_) {}
      process.exit(1);
    });
}

module.exports = seedDevelopmentData;

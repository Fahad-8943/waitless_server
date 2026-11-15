const mongoose = require("mongoose");
const Business = require("../models/Business");
const Booking = require("../models/Booking");
const QueueEntry = require("../models/QueueEntry");
const Service = require("../models/Service");
const ApiError = require("../utils/apiError");
const { getBusinessDayRange } = require("../utils/timezone");

/**
 * Retrieves comprehensive dashboard analytics for a single business venue.
 * Scoped to the business ID (guarded by requireBusinessOwner).
 */
const getBusinessDashboard = async (businessId) => {
  const business = await Business.findById(businessId).lean();
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  const { startOfDay, endOfDay } = getBusinessDayRange(new Date(), business.timezone || "Asia/Kolkata");

  const [
    // 1. Booking metrics
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    rejectedBookings,
    todayBookings,

    // 2. Queue metrics
    activeQueueCount,
    waitingQueueCount,
    calledQueueCount,
    currentlyCalledCustomer,

    // 3. Service metrics
    totalServices,
    activeServices,
    inactiveServices,

    // 4. Recent activity
    recentBookings,
    recentQueueEntries,
  ] = await Promise.all([
    // Bookings
    Booking.countDocuments({ businessId }),
    Booking.countDocuments({ businessId, status: "pending" }),
    Booking.countDocuments({ businessId, status: "confirmed" }),
    Booking.countDocuments({ businessId, status: "completed" }),
    Booking.countDocuments({ businessId, status: "cancelled" }),
    Booking.countDocuments({ businessId, status: "rejected" }),
    Booking.countDocuments({
      businessId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
    }),

    // Queue
    QueueEntry.countDocuments({
      businessId,
      status: { $in: ["waiting", "called", "serving"] },
    }),
    QueueEntry.countDocuments({ businessId, status: "waiting" }),
    QueueEntry.countDocuments({ businessId, status: "called" }),
    QueueEntry.findOne({ businessId, status: "called" })
      .sort({ calledAt: -1 })
      .populate("customerId", "name phone email")
      .lean(),

    // Services
    Service.countDocuments({ businessId }),
    Service.countDocuments({ businessId, isActive: true }),
    Service.countDocuments({ businessId, isActive: false }),

    // Recent Activity
    Booking.find({ businessId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("customerId", "name phone email")
      .lean(),
    QueueEntry.find({ businessId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("customerId", "name phone email")
      .lean(),
  ]);

  return {
    business: {
      _id: business._id,
      name: business.name,
      category: business.category,
      approvalStatus: business.approvalStatus,
      isActive: business.isActive,
      timezone: business.timezone,
      policies: business.policies,
      contact: business.contact,
      address: business.address,
    },
    bookings: {
      total: totalBookings,
      pending: pendingBookings,
      confirmed: confirmedBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      rejected: rejectedBookings,
      todayCount: todayBookings,
    },
    queue: {
      totalActive: activeQueueCount,
      waitingCount: waitingQueueCount,
      calledCount: calledQueueCount,
      currentlyCalled: currentlyCalledCustomer || null,
    },
    services: {
      total: totalServices,
      active: activeServices,
      inactive: inactiveServices,
    },
    recentActivity: {
      bookings: recentBookings,
      queue: recentQueueEntries,
    },
  };
};

/**
 * Retrieves aggregate dashboard overview across all businesses owned by a provider.
 */
const getProviderOverview = async (providerId) => {
  const businesses = await Business.find({ ownerId: providerId }).lean();

  if (businesses.length === 0) {
    return {
      totalBusinesses: 0,
      businesses: [],
      aggregatedStats: {
        totalBookings: 0,
        pendingBookings: 0,
        todayBookings: 0,
        totalActiveQueue: 0,
        totalActiveServices: 0,
      },
    };
  }

  const businessIds = businesses.map((b) => b._id);

  // Aggregated totals across all provider venues with timezone-aware today bookings per venue
  const todayBookingsCounts = await Promise.all(
    businesses.map((b) => {
      const { startOfDay, endOfDay } = getBusinessDayRange(new Date(), b.timezone || "Asia/Kolkata");
      return Booking.countDocuments({
        businessId: b._id,
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      });
    })
  );
  const todayBookings = todayBookingsCounts.reduce((acc, count) => acc + count, 0);

  const [
    totalBookings,
    pendingBookings,
    totalActiveQueue,
    totalActiveServices,
  ] = await Promise.all([
    Booking.countDocuments({ businessId: { $in: businessIds } }),
    Booking.countDocuments({ businessId: { $in: businessIds }, status: "pending" }),
    QueueEntry.countDocuments({
      businessId: { $in: businessIds },
      status: { $in: ["waiting", "called", "serving"] },
    }),
    Service.countDocuments({ businessId: { $in: businessIds }, isActive: true }),
  ]);

  // Per-business summaries
  const businessSummaries = await Promise.all(
    businesses.map(async (b) => {
      const [bookingsCount, activeQueue, activeSvc] = await Promise.all([
        Booking.countDocuments({ businessId: b._id }),
        QueueEntry.countDocuments({
          businessId: b._id,
          status: { $in: ["waiting", "called", "serving"] },
        }),
        Service.countDocuments({ businessId: b._id, isActive: true }),
      ]);
      return {
        _id: b._id,
        name: b.name,
        category: b.category,
        approvalStatus: b.approvalStatus,
        isActive: b.isActive,
        bookingsCount,
        activeQueueCount: activeQueue,
        activeServicesCount: activeSvc,
      };
    })
  );

  return {
    totalBusinesses: businesses.length,
    businesses: businessSummaries,
    aggregatedStats: {
      totalBookings,
      pendingBookings,
      todayBookings,
      totalActiveQueue,
      totalActiveServices,
    },
  };
};

module.exports = {
  getBusinessDashboard,
  getProviderOverview,
};

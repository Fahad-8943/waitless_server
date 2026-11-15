const mongoose = require("mongoose");
const User = require("../models/User");
const Business = require("../models/Business");
const Booking = require("../models/Booking");
const QueueEntry = require("../models/QueueEntry");
const Service = require("../models/Service");
const ApiError = require("../utils/apiError");
const { getBusinessDayRange } = require("../utils/timezone");

/**
 * Aggregates platform-wide metrics across all users, businesses, bookings, queues, and services.
 */
const getPlatformStats = async () => {
  // Aggregate today's bookings across venues respecting each venue's local timezone
  const businesses = await Business.find({}, "_id timezone").lean();
  const todayCounts = await Promise.all(
    businesses.map((b) => {
      const { startOfDay, endOfDay } = getBusinessDayRange(new Date(), b.timezone || "Asia/Kolkata");
      return Booking.countDocuments({
        businessId: b._id,
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      });
    })
  );
  const todayBookings = todayCounts.reduce((acc, c) => acc + c, 0);

  const [
    // Users
    totalUsers,
    customerCount,
    providerCount,
    adminCount,
    activeUsers,
    inactiveUsers,

    // Businesses
    totalBusinesses,
    pendingBusinesses,
    approvedBusinesses,
    suspendedBusinesses,
    rejectedBusinesses,
    activeBusinesses,
    inactiveBusinesses,

    // Bookings
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    rejectedBookings,

    // Queue
    totalActiveQueue,
    waitingQueue,
    calledQueue,

    // Services
    totalServices,
    activeServices,
    inactiveServices,
  ] = await Promise.all([
    // Users
    User.countDocuments(),
    User.countDocuments({ role: "customer" }),
    User.countDocuments({ role: "provider" }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ isActive: false }),

    // Businesses
    Business.countDocuments(),
    Business.countDocuments({ approvalStatus: "pending" }),
    Business.countDocuments({ approvalStatus: "approved" }),
    Business.countDocuments({ approvalStatus: "suspended" }),
    Business.countDocuments({ approvalStatus: "rejected" }),
    Business.countDocuments({ isActive: true }),
    Business.countDocuments({ isActive: false }),

    // Bookings
    Booking.countDocuments(),
    Booking.countDocuments({ status: "pending" }),
    Booking.countDocuments({ status: "confirmed" }),
    Booking.countDocuments({ status: "completed" }),
    Booking.countDocuments({ status: "cancelled" }),
    Booking.countDocuments({ status: "rejected" }),

    // Queue
    QueueEntry.countDocuments({ status: { $in: ["waiting", "called", "serving"] } }),
    QueueEntry.countDocuments({ status: "waiting" }),
    QueueEntry.countDocuments({ status: "called" }),

    // Services
    Service.countDocuments(),
    Service.countDocuments({ isActive: true }),
    Service.countDocuments({ isActive: false }),
  ]);

  return {
    users: {
      total: totalUsers,
      byRole: {
        customer: customerCount,
        provider: providerCount,
        admin: adminCount,
      },
      active: activeUsers,
      inactive: inactiveUsers,
    },
    businesses: {
      total: totalBusinesses,
      byApprovalStatus: {
        pending: pendingBusinesses,
        approved: approvedBusinesses,
        suspended: suspendedBusinesses,
        rejected: rejectedBusinesses,
      },
      active: activeBusinesses,
      inactive: inactiveBusinesses,
    },
    bookings: {
      total: totalBookings,
      byStatus: {
        pending: pendingBookings,
        confirmed: confirmedBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        rejected: rejectedBookings,
      },
      todayCount: todayBookings,
    },
    queue: {
      totalActive: totalActiveQueue,
      waiting: waitingQueue,
      called: calledQueue,
    },
    services: {
      total: totalServices,
      active: activeServices,
      inactive: inactiveServices,
    },
  };
};

/**
 * Retrieves paginated list of users with search and filter capabilities.
 */
const listUsers = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};

  if (query.role) {
    filter.role = query.role;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true" || query.isActive === true;
  }

  if (query.search) {
    const escapedSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escapedSearch, "i");
    filter.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("-passwordHash -__v")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Retrieves paginated list of businesses with search and lifecycle filters.
 */
const listBusinesses = async (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};

  if (query.approvalStatus) {
    filter.approvalStatus = query.approvalStatus;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true" || query.isActive === true;
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.search) {
    const escapedSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escapedSearch, "i");
    filter.$or = [{ name: searchRegex }, { "address.city": searchRegex }];
  }

  const [businesses, total] = await Promise.all([
    Business.find(filter)
      .populate("ownerId", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Business.countDocuments(filter),
  ]);

  return {
    businesses,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Platform Admin approves a pending or rejected business.
 */
const approveBusiness = async (businessId) => {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  business.approvalStatus = "approved";
  business.isActive = true;
  await business.save();

  return business;
};

/**
 * Platform Admin rejects a business.
 */
const rejectBusiness = async (businessId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  business.approvalStatus = "rejected";
  await business.save();

  return business;
};

/**
 * Platform Admin suspends a business.
 */
const suspendBusiness = async (businessId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  business.approvalStatus = "suspended";
  await business.save();

  return business;
};

/**
 * Platform Admin reactivates a suspended or inactive business.
 */
const reactivateBusiness = async (businessId) => {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  business.approvalStatus = "approved";
  business.isActive = true;
  await business.save();

  return business;
};

/**
 * Platform Admin activates or deactivates a user account.
 * Enforces safety guards against self-deactivation and deactivating the last active admin.
 */
const updateUserStatus = async (userId, isActive, adminUserId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest("Invalid user ID format", "INVALID_USER_ID");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }

  // Safety check 1: Prevent self-deactivation
  if (user._id.toString() === adminUserId.toString() && !isActive) {
    throw ApiError.badRequest(
      "You cannot deactivate your own administrative account",
      "UNSAFE_ADMIN_ACTION"
    );
  }

  // Safety check 2: Prevent deactivating the last active administrator
  if (!isActive && user.role === "admin") {
    const activeAdminCount = await User.countDocuments({ role: "admin", isActive: true });
    if (activeAdminCount <= 1) {
      throw ApiError.badRequest(
        "Cannot deactivate the last active platform administrator",
        "UNSAFE_ADMIN_ACTION"
      );
    }
  }

  user.isActive = isActive;

  // Invalidate all active sessions immediately when an account is deactivated
  if (!isActive) {
    user.tokenVersion += 1;
  }

  await user.save();

  return user;
};

module.exports = {
  getPlatformStats,
  listUsers,
  listBusinesses,
  approveBusiness,
  rejectBusiness,
  suspendBusiness,
  reactivateBusiness,
  updateUserStatus,
};

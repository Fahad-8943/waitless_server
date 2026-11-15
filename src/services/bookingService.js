const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Business = require("../models/Business");
const Service = require("../models/Service");
const ApiError = require("../utils/apiError");
const { getBusinessDayRange } = require("../utils/timezone");

/**
 * Creates a new booking for an active service at an approved business.
 * Snapshots service details at creation time.
 */
const createBooking = async (customerId, data) => {
  const { businessId, serviceId, bookingDate, notes } = data;

  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  if (business.approvalStatus !== "approved" || !business.isActive) {
    throw ApiError.badRequest(
      "Business is not currently accepting bookings",
      "BUSINESS_NOT_BOOKABLE"
    );
  }

  const service = await Service.findById(serviceId);
  if (!service) {
    throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");
  }

  if (service.businessId.toString() !== business._id.toString() || !service.isActive) {
    throw ApiError.badRequest(
      "Service is not available for booking at this business",
      "SERVICE_NOT_BOOKABLE"
    );
  }

  const serviceSnapshot = {
    serviceId: service._id,
    name: service.name,
    price: service.price,
    duration: service.duration,
  };

  const booking = await Booking.create({
    businessId: business._id,
    customerId,
    serviceId: service._id,
    serviceSnapshot,
    bookingDate: new Date(bookingDate),
    notes: notes || "",
    status: "pending",
  });

  return booking;
};

/**
 * Retrieves bookings created by the authenticated customer.
 */
const getCustomerBookings = async (customerId, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { customerId };
  if (query.status) {
    filter.status = query.status;
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ bookingDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("businessId", "name category address contact")
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return {
    bookings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Retrieves a single booking by ID with ownership/access control.
 */
const getBookingById = async (bookingId, userId, userRole) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findById(bookingId)
    .populate("businessId", "name category address contact ownerId")
    .populate("customerId", "name email phone")
    .lean();

  if (!booking) {
    throw ApiError.notFound("Booking not found", "BOOKING_NOT_FOUND");
  }

  // Admin bypass
  if (userRole === "admin") {
    return booking;
  }

  const isCustomer = booking.customerId?._id?.toString() === userId.toString();
  const isBusinessOwner = booking.businessId?.ownerId?.toString() === userId.toString();

  if (!isCustomer && !isBusinessOwner) {
    throw ApiError.forbidden(
      "Access denied: You do not have permission to view this booking",
      "FORBIDDEN_BOOKING_ACCESS"
    );
  }

  return booking;
};

/**
 * Cancels a booking by the customer. Only eligible statuses (pending, confirmed) can be cancelled.
 */
const cancelCustomerBooking = async (bookingId, customerId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw ApiError.notFound("Booking not found", "BOOKING_NOT_FOUND");
  }

  if (booking.customerId.toString() !== customerId.toString()) {
    throw ApiError.forbidden(
      "Access denied: You do not own this booking",
      "FORBIDDEN_BOOKING_ACCESS"
    );
  }

  if (["completed", "cancelled", "rejected"].includes(booking.status)) {
    throw ApiError.badRequest(
      `Cannot cancel booking in '${booking.status}' status`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  booking.status = "cancelled";
  booking.cancellationReason = reason || "Cancelled by customer";
  booking.cancelledAt = new Date();
  await booking.save();

  return booking;
};

/**
 * Retrieves bookings for a business venue (guarded by business owner authorization).
 */
const getBusinessBookings = async (businessId, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { businessId };
  if (query.status) {
    filter.status = query.status;
  }

  if (query.date) {
    const business = await Business.findById(businessId).select("timezone").lean();
    const tz = (business && business.timezone) || "Asia/Kolkata";
    const { startOfDay, endOfDay } = getBusinessDayRange(query.date, tz);
    filter.bookingDate = { $gte: startOfDay, $lte: endOfDay };
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ bookingDate: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate("customerId", "name email phone")
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return {
    bookings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Provider confirms a pending booking.
 */
const confirmBooking = async (businessId, bookingId) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findOne({ _id: bookingId, businessId });
  if (!booking) {
    throw ApiError.notFound("Booking not found for this business", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "pending") {
    throw ApiError.badRequest(
      `Cannot confirm booking in '${booking.status}' status. Only pending bookings can be confirmed.`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  booking.status = "confirmed";
  booking.confirmedAt = new Date();
  await booking.save();

  return booking;
};

/**
 * Provider rejects a pending booking.
 */
const rejectBooking = async (businessId, bookingId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findOne({ _id: bookingId, businessId });
  if (!booking) {
    throw ApiError.notFound("Booking not found for this business", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "pending") {
    throw ApiError.badRequest(
      `Cannot reject booking in '${booking.status}' status. Only pending bookings can be rejected.`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  booking.status = "rejected";
  booking.cancellationReason = reason || "Rejected by provider";
  booking.rejectedAt = new Date();
  await booking.save();

  return booking;
};

/**
 * Provider marks a confirmed booking as completed.
 */
const completeBooking = async (businessId, bookingId) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findOne({ _id: bookingId, businessId });
  if (!booking) {
    throw ApiError.notFound("Booking not found for this business", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "confirmed") {
    throw ApiError.badRequest(
      `Cannot complete booking in '${booking.status}' status. Only confirmed bookings can be marked as completed.`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  booking.status = "completed";
  booking.completedAt = new Date();
  await booking.save();

  return booking;
};

/**
 * Provider cancels a pending or confirmed booking.
 */
const cancelProviderBooking = async (businessId, bookingId, reason = null) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw ApiError.badRequest("Invalid booking ID format", "INVALID_BOOKING_ID");
  }

  const booking = await Booking.findOne({ _id: bookingId, businessId });
  if (!booking) {
    throw ApiError.notFound("Booking not found for this business", "BOOKING_NOT_FOUND");
  }

  if (["completed", "cancelled", "rejected"].includes(booking.status)) {
    throw ApiError.badRequest(
      `Cannot cancel booking in '${booking.status}' status`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  booking.status = "cancelled";
  booking.cancellationReason = reason || "Cancelled by provider";
  booking.cancelledAt = new Date();
  await booking.save();

  return booking;
};

module.exports = {
  createBooking,
  getCustomerBookings,
  getBookingById,
  cancelCustomerBooking,
  getBusinessBookings,
  confirmBooking,
  rejectBooking,
  completeBooking,
  cancelProviderBooking,
};

const bookingService = require("../services/bookingService");
const ApiResponse = require("../utils/apiResponse");
const {
  createBookingSchema,
  cancelBookingSchema,
  rejectBookingSchema,
} = require("../validators/bookingValidators");

/**
 * Customer creates a new booking.
 */
const createBooking = async (req, res, next) => {
  try {
    const validatedData = createBookingSchema.parse(req.body);
    const booking = await bookingService.createBooking(req.user._id, validatedData);
    return ApiResponse.created(res, "Booking created successfully", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Customer retrieves their own bookings.
 */
const getCustomerBookings = async (req, res, next) => {
  try {
    const result = await bookingService.getCustomerBookings(req.user._id, req.query);
    return ApiResponse.ok(
      res,
      "Customer bookings retrieved successfully",
      result.bookings,
      result.pagination
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve single booking by ID (accessible by customer, provider owner, or admin).
 */
const getBookingById = async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(
      req.params.bookingId,
      req.user._id,
      req.user.role
    );
    return ApiResponse.ok(res, "Booking retrieved successfully", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Customer cancels their booking.
 */
const cancelCustomerBooking = async (req, res, next) => {
  try {
    const validatedData = cancelBookingSchema.parse(req.body || {});
    const booking = await bookingService.cancelCustomerBooking(
      req.params.bookingId,
      req.user._id,
      validatedData.reason
    );
    return ApiResponse.ok(res, "Booking cancelled successfully", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider retrieves bookings for their business venue.
 */
const getBusinessBookings = async (req, res, next) => {
  try {
    const result = await bookingService.getBusinessBookings(req.params.businessId, req.query);
    return ApiResponse.ok(
      res,
      "Business bookings retrieved successfully",
      result.bookings,
      result.pagination
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Provider confirms a pending booking.
 */
const confirmBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.confirmBooking(
      req.params.businessId,
      req.params.bookingId
    );
    return ApiResponse.ok(res, "Booking confirmed successfully", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider rejects a pending booking.
 */
const rejectBooking = async (req, res, next) => {
  try {
    const validatedData = rejectBookingSchema.parse(req.body || {});
    const booking = await bookingService.rejectBooking(
      req.params.businessId,
      req.params.bookingId,
      validatedData.reason
    );
    return ApiResponse.ok(res, "Booking rejected successfully", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider marks a confirmed booking as completed.
 */
const completeBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.completeBooking(
      req.params.businessId,
      req.params.bookingId
    );
    return ApiResponse.ok(res, "Booking marked as completed", booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Provider cancels a booking for their business.
 */
const cancelProviderBooking = async (req, res, next) => {
  try {
    const validatedData = cancelBookingSchema.parse(req.body || {});
    const booking = await bookingService.cancelProviderBooking(
      req.params.businessId,
      req.params.bookingId,
      validatedData.reason
    );
    return ApiResponse.ok(res, "Booking cancelled successfully", booking);
  } catch (error) {
    next(error);
  }
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

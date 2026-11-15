const mongoose = require("mongoose");
const Service = require("../models/Service");
const Business = require("../models/Business");
const ApiError = require("../utils/apiError");

/**
 * Create a new service for an owned business venue.
 *
 * @param {string|ObjectId} businessId
 * @param {Object} payload
 * @returns {Promise<Service>}
 */
const createService = async (businessId, payload) => {
  const service = await Service.create({
    businessId,
    name: payload.name,
    description: payload.description || "",
    price: payload.price,
    duration: payload.duration,
    isActive: payload.isActive !== undefined ? payload.isActive : true,
  });

  return service;
};

/**
 * List all services belonging to a business venue (Owner/Admin view).
 *
 * @param {string|ObjectId} businessId
 * @returns {Promise<Array<Service>>}
 */
const getServicesByBusiness = async (businessId) => {
  return await Service.find({ businessId }).sort({ createdAt: -1 });
};

/**
 * View individual service details belonging to a business venue.
 *
 * @param {string|ObjectId} businessId
 * @param {string|ObjectId} serviceId
 * @returns {Promise<Service>}
 */
const getServiceById = async (businessId, serviceId) => {
  if (!mongoose.Types.ObjectId.isValid(serviceId)) {
    throw ApiError.badRequest("Invalid service ID format", "INVALID_SERVICE_ID");
  }

  const service = await Service.findOne({ _id: serviceId, businessId });
  if (!service) {
    throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");
  }

  return service;
};

/**
 * Update service details (name, description, price, duration, isActive).
 *
 * @param {string|ObjectId} businessId
 * @param {string|ObjectId} serviceId
 * @param {Object} payload
 * @returns {Promise<Service>}
 */
const updateService = async (businessId, serviceId, payload) => {
  if (!mongoose.Types.ObjectId.isValid(serviceId)) {
    throw ApiError.badRequest("Invalid service ID format", "INVALID_SERVICE_ID");
  }

  const updateOps = {};
  if (payload.name !== undefined) updateOps.name = payload.name;
  if (payload.description !== undefined) updateOps.description = payload.description;
  if (payload.price !== undefined) updateOps.price = payload.price;
  if (payload.duration !== undefined) updateOps.duration = payload.duration;
  if (payload.isActive !== undefined) updateOps.isActive = payload.isActive;

  if (Object.keys(updateOps).length === 0) {
    return await getServiceById(businessId, serviceId);
  }

  const updated = await Service.findOneAndUpdate(
    { _id: serviceId, businessId },
    { $set: updateOps },
    { returnDocument: "after", runValidators: true }
  );

  if (!updated) {
    throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");
  }

  return updated;
};

/**
 * List active services for a publicly accessible business.
 * Strictly verifies that the business is approved and active.
 *
 * @param {string|ObjectId} businessId
 * @returns {Promise<Array<Object>>}
 */
const getPublicServicesForBusiness = async (businessId) => {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    throw ApiError.badRequest("Invalid business ID format", "INVALID_BUSINESS_ID");
  }

  // Verify business is approved and active
  const business = await Business.findOne({
    _id: businessId,
    approvalStatus: "approved",
    isActive: true,
  });

  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  // Return active services only
  const services = await Service.find({
    businessId: business._id,
    isActive: true,
  })
    .select("_id businessId name description price duration")
    .sort({ price: 1, name: 1 });

  return services;
};

module.exports = {
  createService,
  getServicesByBusiness,
  getServiceById,
  updateService,
  getPublicServicesForBusiness,
};

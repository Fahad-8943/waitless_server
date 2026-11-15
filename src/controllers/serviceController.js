const serviceService = require("../services/serviceService");
const {
  createServiceSchema,
  updateServiceSchema,
} = require("../validators/serviceValidators");
const ApiResponse = require("../utils/apiResponse");

/**
 * Create a new service for an owned business venue.
 */
const createService = async (req, res) => {
  const validated = createServiceSchema.parse(req.body);
  const service = await serviceService.createService(req.business._id, validated);

  return ApiResponse.created(res, "Service created successfully", {
    service,
  });
};

/**
 * List all services belonging to a business venue (Owner/Admin).
 */
const getBusinessServices = async (req, res) => {
  const services = await serviceService.getServicesByBusiness(req.business._id);

  return ApiResponse.ok(res, "Services retrieved successfully", {
    services,
  });
};

/**
 * Get individual service details.
 */
const getServiceDetails = async (req, res) => {
  const service = await serviceService.getServiceById(
    req.business._id,
    req.params.serviceId
  );

  return ApiResponse.ok(res, "Service details retrieved successfully", {
    service,
  });
};

/**
 * Update service details (name, description, price, duration, isActive).
 */
const updateService = async (req, res) => {
  const validated = updateServiceSchema.parse(req.body);
  const updatedService = await serviceService.updateService(
    req.business._id,
    req.params.serviceId,
    validated
  );

  return ApiResponse.ok(res, "Service updated successfully", {
    service: updatedService,
  });
};

/**
 * Get active services for a public business venue.
 */
const getPublicServices = async (req, res) => {
  const services = await serviceService.getPublicServicesForBusiness(
    req.params.businessId
  );

  return ApiResponse.ok(res, "Public services retrieved successfully", {
    services,
  });
};

module.exports = {
  createService,
  getBusinessServices,
  getServiceDetails,
  updateService,
  getPublicServices,
};

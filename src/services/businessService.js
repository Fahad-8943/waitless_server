const Business = require("../models/Business");
const User = require("../models/User");
const { withTransactionRetry } = require("../utils/transaction");
const { signAccessToken } = require("./authService");
const env = require("../config/env");
const ApiError = require("../utils/apiError");

/**
 * Register a new business venue atomically inside a MongoDB transaction.
 *
 * Transaction Workflow:
 * 1. Inside transaction:
 *    a. If user.role === 'customer', conditionally elevate role to 'provider' and increment tokenVersion + 1.
 *    b. Insert Business document (ownerId = user._id, approvalStatus = env.DEFAULT_BUSINESS_APPROVAL_STATUS).
 * 2. Commit transaction.
 * 3. ONLY after successful commit, issue a fresh access token (if elevated) with role: 'provider'
 *    and the updated tokenVersion, invalidating the old customer access token.
 * 4. Return { business, accessToken }.
 */
const registerBusiness = async (user, payload) => {
  let roleElevated = false;
  let updatedUser = user;

  const result = await withTransactionRetry(async (session) => {
    // 1. Conditional atomic role elevation from 'customer' to 'provider'
    // Matches role: 'customer' conditionally to prevent redundant tokenVersion increments under concurrency.
    const elevated = await User.findOneAndUpdate(
      { _id: user._id, role: "customer" },
      {
        $set: { role: "provider" },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: "after", session }
    );

    if (elevated) {
      updatedUser = elevated;
      roleElevated = true;
    } else {
      // User is already a provider/admin or was elevated concurrently
      const currentUser = await User.findById(user._id).session(session);
      if (!currentUser) {
        throw ApiError.notFound("User account not found", "USER_NOT_FOUND");
      }
      updatedUser = currentUser;
      roleElevated = false;
    }

    // 2. Insert Business document
    const businessData = {
      name: payload.name,
      category: payload.category,
      description: payload.description || "",
      contact: payload.contact || {
        email: updatedUser.email || null,
        phone: updatedUser.phone || null,
      },
      address: payload.address,
      location: {
        type: "Point",
        coordinates: payload.location.coordinates,
      },
      timezone: payload.timezone || "Asia/Kolkata",
      operatingHours: payload.operatingHours || [],
      specialClosures: payload.specialClosures || [],
      policies: payload.policies || {},
      ownerId: updatedUser._id,
      approvalStatus: env.DEFAULT_BUSINESS_APPROVAL_STATUS,
      isActive: true,
    };

    const [business] = await Business.create([businessData], { session });

    return { business };
  });

  // 3. Issue fresh access token ONLY after successful transaction commit
  let newAccessToken = null;
  if (roleElevated) {
    newAccessToken = signAccessToken(updatedUser);
  }

  return {
    business: result.business,
    accessToken: newAccessToken,
  };
};

/**
 * Get all businesses owned by the authenticated user.
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<Array<Business>>}
 */
const getMyBusinesses = async (userId) => {
  return await Business.find({ ownerId: userId, isActive: true }).sort({ createdAt: -1 });
};

/**
 * Retrieve one business profile by ID.
 *
 * @param {string|ObjectId} businessId
 * @returns {Promise<Business>}
 */
const getBusinessById = async (businessId) => {
  const business = await Business.findById(businessId);
  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }
  return business;
};

/**
 * Partially update a business profile.
 * Preserves omitted fields and prevents changes to internal/protected fields.
 *
 * @param {string|ObjectId} businessId
 * @param {Object} payload - Validated update fields
 * @returns {Promise<Business>}
 */
const updateBusinessProfile = async (businessId, payload) => {
  const updateOps = {};

  if (payload.name !== undefined) updateOps.name = payload.name;
  if (payload.category !== undefined) updateOps.category = payload.category;
  if (payload.description !== undefined) updateOps.description = payload.description;
  if (payload.timezone !== undefined) updateOps.timezone = payload.timezone;

  if (payload.contact) {
    if (payload.contact.email !== undefined) updateOps["contact.email"] = payload.contact.email;
    if (payload.contact.phone !== undefined) updateOps["contact.phone"] = payload.contact.phone;
  }

  if (payload.address) {
    if (payload.address.street !== undefined) updateOps["address.street"] = payload.address.street;
    if (payload.address.city !== undefined) updateOps["address.city"] = payload.address.city;
    if (payload.address.state !== undefined) updateOps["address.state"] = payload.address.state;
    if (payload.address.postalCode !== undefined) updateOps["address.postalCode"] = payload.address.postalCode;
    if (payload.address.country !== undefined) updateOps["address.country"] = payload.address.country;
  }

  if (payload.location && payload.location.coordinates !== undefined) {
    updateOps["location.coordinates"] = payload.location.coordinates;
    updateOps["location.type"] = "Point";
  }

  if (Object.keys(updateOps).length === 0) {
    return await getBusinessById(businessId);
  }

  const updated = await Business.findByIdAndUpdate(
    businessId,
    { $set: updateOps },
    { returnDocument: "after", runValidators: true }
  );

  if (!updated) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  return updated;
};

/**
 * Get sanitized public business profile.
 * Only returns venues that are both approved and active.
 * Never exposes internal fields (ownerId, approvalStatus, policies, etc.).
 *
 * @param {string|ObjectId} businessId
 * @returns {Promise<Object>}
 */
const getPublicBusinessProfile = async (businessId) => {
  const business = await Business.findOne({
    _id: businessId,
    approvalStatus: "approved",
    isActive: true,
  });

  if (!business) {
    throw ApiError.notFound("Business venue not found", "BUSINESS_NOT_FOUND");
  }

  return {
    _id: business._id,
    name: business.name,
    category: business.category,
    description: business.description,
    contact: {
      email: business.contact?.email || null,
      phone: business.contact?.phone || null,
    },
    address: {
      street: business.address.street,
      city: business.address.city,
      state: business.address.state,
      postalCode: business.address.postalCode,
      country: business.address.country,
    },
    location: {
      type: business.location.type,
      coordinates: business.location.coordinates,
    },
    timezone: business.timezone,
  };
};

/**
 * List approved and active businesses for public discovery.
 * Supports filtering by category, search term (name/city), and pagination.
 * Never exposes private/internal business fields.
 *
 * @param {Object} queryParams
 * @returns {Promise<{ businesses: Array, pagination: Object }>}
 */
const getPublicBusinesses = async (queryParams = {}) => {
  const filter = {
    approvalStatus: "approved",
    isActive: true,
  };

  if (queryParams.category) {
    filter.category = queryParams.category;
  }

  if (queryParams.search && queryParams.search.trim()) {
    const term = queryParams.search.trim();
    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { "address.city": { $regex: term, $options: "i" } },
    ];
  }

  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(queryParams.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [businesses, total] = await Promise.all([
    Business.find(filter)
      .select("_id name category description contact address location timezone createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Business.countDocuments(filter),
  ]);

  const sanitized = businesses.map((b) => ({
    _id: b._id,
    name: b.name,
    category: b.category,
    description: b.description,
    contact: {
      email: b.contact?.email || null,
      phone: b.contact?.phone || null,
    },
    address: {
      street: b.address.street,
      city: b.address.city,
      state: b.address.state,
      postalCode: b.address.postalCode,
      country: b.address.country,
    },
    location: {
      type: b.location.type,
      coordinates: b.location.coordinates,
    },
    timezone: b.timezone,
    createdAt: b.createdAt,
  }));

  return {
    businesses: sanitized,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };
};

module.exports = {
  registerBusiness,
  getMyBusinesses,
  getBusinessById,
  updateBusinessProfile,
  getPublicBusinessProfile,
  getPublicBusinesses,
};

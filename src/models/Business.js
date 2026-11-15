const mongoose = require("mongoose");
const env = require("../config/env");

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Business name is required"],
      trim: true,
      minlength: [2, "Business name must be at least 2 characters"],
      maxlength: [100, "Business name cannot exceed 100 characters"],
    },
    category: {
      type: String,
      required: [true, "Business category is required"],
      enum: {
        values: [
          "Barbers & Salons",
          "Health & Clinics",
          "Auto Service & Repair",
          "Dining & Cafes",
          "Beauty & Wellness",
          "Fitness & Physical Therapy",
          "Other Local Service",
        ],
        message: "{VALUE} is not a valid business category",
      },
      index: true,
    },
    description: {
      type: String,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "",
    },
    contact: {
      email: {
        type: String,
        trim: true,
        lowercase: true,
        default: null,
      },
      phone: {
        type: String,
        trim: true,
        default: null,
      },
    },
    address: {
      street: { type: String, required: [true, "Street address is required"], trim: true },
      city: { type: String, required: [true, "City is required"], trim: true },
      state: { type: String, required: [true, "State is required"], trim: true },
      postalCode: { type: String, required: [true, "Postal code is required"], trim: true },
      country: { type: String, default: "IN", trim: true },
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: [true, "Coordinates [longitude, latitude] are required"],
        validate: {
          validator: (coords) =>
            Array.isArray(coords) &&
            coords.length === 2 &&
            coords[0] >= -180 &&
            coords[0] <= 180 &&
            coords[1] >= -90 &&
            coords[1] <= 90,
          message: "Coordinates must be [longitude (-180 to 180), latitude (-90 to 90)]",
        },
      },
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
      trim: true,
    },
    operatingHours: [
      {
        dayOfWeek: { type: Number, min: 0, max: 6, required: true },
        openTime: { type: String, required: true },
        closeTime: { type: String, required: true },
        isOvernight: { type: Boolean, default: false },
        isClosed: { type: Boolean, default: false },
      },
    ],
    specialClosures: [
      {
        date: { type: String, required: true },
        reason: { type: String, default: "Holiday" },
      },
    ],
    policies: {
      maxQueueCapacity: { type: Number, default: 50, min: 1 },
      remoteQueueEnabled: { type: Boolean, default: true },
      gracePeriodMinutes: { type: Number, default: 10, min: 0 },
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required"],
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "suspended", "rejected"],
      default: () => env.DEFAULT_BUSINESS_APPROVAL_STATUS,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

businessSchema.index({ location: "2dsphere" });
businessSchema.index({ ownerId: 1, isActive: 1 });
businessSchema.index({ category: 1, approvalStatus: 1, isActive: 1 });

const Business = mongoose.model("Business", businessSchema);
module.exports = Business;

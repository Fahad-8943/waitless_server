const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "Business ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      minlength: [2, "Service name must be at least 2 characters"],
      maxlength: [100, "Service name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "",
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price must be at least 0"],
    },
    duration: {
      type: Number,
      required: [true, "Duration in minutes is required"],
      min: [1, "Duration must be at least 1 minute"],
      validate: {
        validator: Number.isInteger,
        message: "Duration must be an integer number of minutes",
      },
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

serviceSchema.index({ businessId: 1, isActive: 1 });
serviceSchema.index({ businessId: 1, name: 1 });

const Service = mongoose.model("Service", serviceSchema);

module.exports = Service;

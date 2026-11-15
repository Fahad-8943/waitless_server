const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "Business ID is required"],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Customer ID is required"],
      index: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "Service ID is required"],
    },
    serviceSnapshot: {
      serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: [true, "Snapshot serviceId is required"],
      },
      name: {
        type: String,
        required: [true, "Snapshot service name is required"],
        trim: true,
      },
      price: {
        type: Number,
        required: [true, "Snapshot service price is required"],
        min: 0,
      },
      duration: {
        type: Number,
        required: [true, "Snapshot service duration is required"],
        min: 1,
      },
    },
    bookingDate: {
      type: Date,
      required: [true, "Booking date and time is required"],
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "rejected", "cancelled", "completed"],
      default: "pending",
      index: true,
    },
    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: "",
      trim: true,
    },
    cancellationReason: {
      type: String,
      maxlength: [500, "Cancellation reason cannot exceed 500 characters"],
      default: null,
      trim: true,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ businessId: 1, bookingDate: 1 });
bookingSchema.index({ customerId: 1, bookingDate: -1 });
bookingSchema.index({ businessId: 1, status: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;

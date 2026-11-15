const mongoose = require("mongoose");

const queueEntrySchema = new mongoose.Schema(
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
      default: null,
    },
    serviceSnapshot: {
      serviceId: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, trim: true },
      price: { type: Number, min: 0 },
      duration: { type: Number, min: 1 },
    },
    tokenNumber: {
      type: Number,
      required: [true, "Token number is required"],
      min: 1,
    },
    tokenDisplay: {
      type: String,
      required: [true, "Token display string is required"],
      trim: true,
    },
    dateStr: {
      type: String,
      required: [true, "Date string is required"],
      index: true,
    },
    status: {
      type: String,
      enum: ["waiting", "called", "serving", "completed", "skipped", "cancelled"],
      default: "waiting",
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
    joinedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    calledAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    skippedAt: {
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

// Compound partial unique index: A customer can only have one active queue entry per business
queueEntrySchema.index(
  { businessId: 1, customerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["waiting", "called", "serving"] } },
  }
);

queueEntrySchema.index({ businessId: 1, status: 1, joinedAt: 1 });
queueEntrySchema.index({ customerId: 1, joinedAt: -1 });
queueEntrySchema.index({ businessId: 1, dateStr: 1, tokenNumber: 1 });

const QueueEntry = mongoose.model("QueueEntry", queueEntrySchema);

module.exports = QueueEntry;

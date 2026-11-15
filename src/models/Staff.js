const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "Business ID is required"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Staff name is required"],
      trim: true,
      maxlength: [100, "Staff name cannot exceed 100 characters"],
    },
    role: {
      type: String,
      enum: {
        values: ["owner", "manager", "staff"],
        message: "{VALUE} is not a valid staff membership role",
      },
      default: "staff",
      required: true,
      index: true,
    },
    assignedServices: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
      },
    ],
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Exactly one membership record per user per business venue
staffSchema.index({ businessId: 1, userId: 1 }, { unique: true });
staffSchema.index({ businessId: 1, role: 1, isActive: 1 });
staffSchema.index({ userId: 1, isActive: 1 });

// Engine constraint: Exactly one active owner Staff membership per business venue
staffSchema.index(
  { businessId: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: "owner", isActive: true },
  }
);

// Virtual reverse-populate of active station from Counter SSOT
staffSchema.virtual("currentCounter", {
  ref: "Counter",
  localField: "_id",
  foreignField: "currentStaffId",
  justOne: true,
  match: { isActive: true },
});

const Staff = mongoose.model("Staff", staffSchema);
module.exports = Staff;

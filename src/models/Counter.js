const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    dateStr: {
      type: String,
      required: true,
      index: true,
    },
    seq: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

counterSchema.index({ businessId: 1, dateStr: 1 }, { unique: true });

const Counter = mongoose.model("Counter", counterSchema);

module.exports = Counter;

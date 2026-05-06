const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  // Customer details
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerAddress: { type: String, required: true },
  customerEmail: { type: String, required: true },

  // Customer reference (logged-in user)
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  // Service details
  workDescription: { type: String, required: true },

  // Provider reference
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Provider",
    required: true
  },

  // Status
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "completed"],
    default: "pending"
  },

  // OTP for verification
  otp: String,
  otpExpires: Date,

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date
}, { timestamps: true });

const Booking = mongoose.model("Booking", bookingSchema);
module.exports = Booking;

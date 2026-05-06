const mongoose = require("mongoose");

const providerSchema = new mongoose.Schema({
  // 🔐 Credentials
  name: String,
  email: { type: String, unique: true },
  password: String,

  phone: String,
  address: String,

  // 📍 Location
  location: {
    type: {
      type: String,
      default: "Point"
    },
    coordinates: [Number] // [lng, lat]
  },

  // 🛠️ Services
  services: [String],

  experience: Number, // years
  category: String,

  // 💰 Price Range
  priceRange: {
    min: Number,
    max: Number,
    unit: { type: String, default: "per visit" } // per visit, per hour, per day
  },

  // 🧾 Verification
  aadhaarNumber: String,
  aadhaarImage: String, // store file path / URL
  profileImage: String,

  isVerified: {
    type: Boolean,
    default: false
  },

  // 🔑 SuperAdmin Approval Status
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  rejectionReason: String,

  // ⭐ Ratings
  rating: {
    type: Number,
    default: 0
  },

  totalReviews: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

providerSchema.index({ location: "2dsphere" });

const Provider = mongoose.model("Provider", providerSchema);
module.exports = Provider;
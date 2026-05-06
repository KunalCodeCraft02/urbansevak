const mongoose = require("mongoose");

const superAdminSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}, { timestamps: true });

const SuperAdmin = mongoose.model("SuperAdmin", superAdminSchema);
module.exports = SuperAdmin;

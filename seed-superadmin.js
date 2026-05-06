const mongoose = require("./config/database");
const SuperAdmin = require("./models/superadmin");
const bcrypt = require("bcryptjs");

async function seedSuperAdmin() {
  await mongoose.connect(process.env.MONGODB_URL || "mongodb://localhost:27017/hitech");

  const existing = await SuperAdmin.findOne({ username: "admin" });
  if (existing) {
    console.log("SuperAdmin already exists!");
    process.exit(0);
  }

  const hashedPassword = await bcrypt.hash("admin123", 10);

  const admin = new SuperAdmin({
    username: "admin",
    password: hashedPassword
  });

  await admin.save();
  console.log("SuperAdmin created! Username: admin, Password: admin123");
  process.exit(0);
}

seedSuperAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});

const express = require("express");
const mongoose = require("mongoose");
const db = require("./config/database");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
require("dotenv").config();
const upload = require("./config/multer");

const User = require("./models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Provider = require("./models/serviceprovider");
const Booking = require("./models/booking");
const SuperAdmin = require("./models/superadmin");
const nodemailer = require("nodemailer");
const { categories, getCategoryFromServices } = require("./config/serviceCategories");

// Email Transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

// Provider Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(" ")[1]);
    if (!token) {
      return res.redirect("/providerlogin");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");

    // Check if it's a provider
    if (decoded.role !== "provider") {
      return res.redirect("/providerlogin");
    }

    const provider = await Provider.findById(decoded.id);
    if (!provider) {
      return res.redirect("/providerlogin");
    }

    req.provider = provider;
    next();
  } catch (err) {
    return res.redirect("/providerlogin");
  }
};

// User Authentication Middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(" ")[1]);
    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");

    // Check if it's a user
    if (decoded.role !== "user") {
      return res.redirect("/login");
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.redirect("/login");
    }

    req.user = user;
    next();
  } catch (err) {
    return res.redirect("/login");
  }
};

// GET ROUTES

app.get("/", (req, res) => {
  res.render("index", { categories });
});

app.get("/home", authenticateUser, (req, res) => {
  res.render("home", { categories });
});

app.get("/signup", (req, res) => {
  res.render("signup");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/signupas", (req, res) => {
  res.render("signupas");
});

app.get("/sprovidersignup", (req, res) => {
  res.render("sprovidersignup");
});

app.get("/providerlogin", (req, res) => {
  res.render("providerlogin");
});

app.get("/provideradmin", authenticateToken, async (req, res) => {
  try {
    const pendingCount = await Booking.countDocuments({ provider: req.provider._id, status: "pending" });
    const acceptedCount = await Booking.countDocuments({ provider: req.provider._id, status: "accepted" });
    const completedCount = await Booking.countDocuments({ provider: req.provider._id, status: "completed" });

    res.render("provideradmin", {
      provider: req.provider,
      pendingCount,
      acceptedCount,
      completedCount
    });
  } catch (err) {
    console.error(err);
    res.render("provideradmin", { provider: req.provider, pendingCount: 0, acceptedCount: 0, completedCount: 0 });
  }
});

// GET /providers - List providers by category, sorted by distance
// Query params: category, lat, lng
app.get("/providers", async (req, res) => {
  try {
    const { category, lat, lng } = req.query;

    // Check if user is authenticated
    let user = null;
    try {
      const token = req.cookies.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
        if (decoded.role === "user") {
          user = await User.findById(decoded.id);
        }
      }
    } catch (e) {
      // User not authenticated, continue without user
    }

    if (!category) {
      return res.render("providers", { providers: [], category: null, lat: null, lng: null, user });
    }

    // If no location provided, just filter by category
    if (!lat || !lng) {
      const providers = await Provider.find({ category });
      return res.render("providers", { providers, category, lat: null, lng: null, user });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // Validate coordinates
    if (isNaN(userLat) || isNaN(userLng)) {
      const providers = await Provider.find({ category });
      return res.render("providers", { providers, category, lat: null, lng: null, user });
    }

    // Use MongoDB geoNear aggregation to find providers within 10km, sorted by distance
    const providers = await Provider.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [userLng, userLat]
          },
          distanceField: "distance",
          maxDistance: 10000, // 10km in meters
          query: { category },
          spherical: true
        }
      }
    ]);

    res.render("providers", { providers, category, lat: userLat, lng: userLng, user });

  } catch (err) {
    console.error(err);
    res.send("Error loading providers");
  }
});

// Legacy route - redirect to new /providers route
app.get("/providers/:category", (req, res) => {
  const category = req.params.category;
  res.redirect(`/providers?category=${encodeURIComponent(category)}`);
});

// POST ROUTES

app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, phone, address, lat, lng } = req.body;

    if (!name || !email || !password || !phone || !address) {
      return res.status(400).json({ msg: "All fields required" });
    }

    if (!lat || !lng) {
      return res.status(400).json({ msg: "Location required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      address,
      location: {
        type: "Point",
        coordinates: [parseFloat(lng), parseFloat(lat)]
      }
    });

    await user.save();

    const token = jwt.sign(
      { id: user._id, role: "user" },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(201).json({ msg: "Signup successful", redirect: "/home" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user._id, role: "user" },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ msg: "Login successful", redirect: "/home" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/providerlogin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password required" });
    }

    const provider = await Provider.findOne({ email });
    if (!provider) {
      return res.status(400).json({ msg: "Provider not found" });
    }

    const isMatch = await bcrypt.compare(password, provider.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid password" });
    }

    const token = jwt.sign(
      { id: provider._id, role: "provider" },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ msg: "Login successful", redirect: "/provideradmin" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  "/providersignup",
  upload.fields([
    { name: "aadhaarImage", maxCount: 1 },
    { name: "profileImage", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone,
        address,
        services,
        experience,
        aadhaarNumber,
        lat,
        lng,
        priceMin,
        priceMax,
        priceUnit
      } = req.body;

      if (!name || !email || !password || !phone || !address) {
        return res.status(400).json({ msg: "All fields required" });
      }

      if (!lat || !lng) {
        return res.status(400).json({ msg: "Location required" });
      }

      const aadhaarImage = req.files["aadhaarImage"]?.[0]?.filename;
      const profileImage = req.files["profileImage"]?.[0]?.filename;

      if (!aadhaarImage || !profileImage) {
        return res.status(400).json({ msg: "Images required" });
      }

      const existing = await Provider.findOne({ email });
      if (existing) {
        return res.status(400).json({ msg: "Provider already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Parse services and auto-assign category
      const servicesArray = Array.isArray(services) ? services : services.split(",").map(s => s.trim()).filter(Boolean);
      const category = getCategoryFromServices(servicesArray);

      const provider = new Provider({
        name,
        email,
        password: hashedPassword,
        phone,
        address,
        services: servicesArray,
        experience: experience ? parseInt(experience) : 0,
        aadhaarNumber,
        aadhaarImage,
        profileImage,
        category, // Auto-assigned
        location: {
          type: "Point",
          coordinates: [parseFloat(lng), parseFloat(lat)]
        }
      });

      await provider.save();

      // Provider is pending approval - notify SuperAdmin
      // TODO: Send email todo SuperAdmin

      res.status(201).json({ msg: "Provider signup successful. Awaiting admin approval.", redirect: "/providerlogin" });
      const token = jwt.sign(
        { id: provider._id, role: "provider" },
        process.env.JWT_SECRET || "secretkey",
        { expiresIn: "7d" }
      );

      res.cookie("token", token, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.status(201).json({ msg: "Provider signup successful", redirect: "/provideradmin" });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

// BOOKING ROUTES

// POST /bookings - Create a new booking request
app.post("/bookings", async (req, res) => {
  try {
    const { providerId, customerName, customerPhone, customerEmail, customerAddress, workDescription, customerId } = req.body;

    if (!providerId || !customerName || !customerPhone || !customerEmail || !customerAddress || !workDescription) {
      return res.status(400).json({ msg: "All fields are required" });
    }

    const provider = await Provider.findById(providerId);
    if (!provider) {
      return res.status(404).json({ msg: "Provider not found" });
    }

    const bookingData = {
      provider: providerId,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      workDescription,
      status: "pending"
    };

    // Link to user if customerId is provided
    if (customerId) {
      bookingData.customer = customerId;
    }

    const booking = new Booking(bookingData);
    await booking.save();

    res.status(201).json({ msg: "Booking request sent successfully", booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/bookings - Get all bookings for the logged-in user
app.get("/api/user/bookings", authenticateUser, async (req, res) => {
  try {
    const bookings = await Booking.find({ customer: req.user._id }).populate('provider').sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:providerId - Get all bookings for a provider
app.get("/api/bookings/:providerId", authenticateToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ provider: req.params.providerId }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/accept - Accept a booking
app.post("/api/bookings/:id/accept", authenticateToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    booking.otp = otp;
    booking.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
    booking.status = "accepted";
    await booking.save();

    // Send OTP via email to customer
    const customerMailOptions = {
      from: process.env.EMAIL_USER,
      to: booking.customerEmail,
      subject: "HITECH - Your Booking OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0B0F; color: #F0F1F5;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #00C46A; font-family: 'Syne', sans-serif;">HITECH</h1>
          </div>
          <div style="background: #1A1D27; padding: 30px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.07);">
            <h2 style="color: #fff; margin-bottom: 10px;">Booking Accepted! 🎉</h2>
            <p style="color: #7B8094; margin-bottom: 20px;">Your service booking has been accepted by the provider.</p>
            <div style="background: rgba(0,196,106,0.1); border: 1px solid rgba(0,196,106,0.3); border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
              <p style="color: #7B8094; margin: 0 0 8px 0; font-size: 14px;">Your OTP for service verification</p>
              <h1 style="color: #00C46A; margin: 0; font-size: 48px; letter-spacing: 8px;">${otp}</h1>
              <p style="color: #7B8094; margin: 8px 0 0 0; font-size: 12px;">This OTP is valid for 10 minutes</p>
            </div>
            <div style="margin: 20px 0; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Work:</strong> ${booking.workDescription}</p>
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Address:</strong> ${booking.customerAddress}</p>
            </div>
            <p style="color: #7B8094; font-size: 13px; margin-top: 20px;">Share this OTP with your service provider when they arrive for work verification.</p>
          </div>
          <p style="text-align: center; color: #4A4F65; font-size: 12px; margin-top: 20px;">© 2026 HITECH International Ltd.</p>
        </div>
      `
    };

    // Send OTP via email to provider
    const provider = await Provider.findById(booking.provider);
    const providerMailOptions = {
      from: process.env.EMAIL_USER,
      to: provider.email,
      subject: "HITECH - Booking Accepted - OTP Details",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0B0F; color: #F0F1F5;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #00C46A; font-family: 'Syne', sans-serif;">HITECH</h1>
          </div>
          <div style="background: #1A1D27; padding: 30px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.07);">
            <h2 style="color: #fff; margin-bottom: 10px;">New Booking OTP ℹ️</h2>
            <p style="color: #7B8094; margin-bottom: 20px;">You accepted a booking. Here's the OTP for work verification:</p>
            <div style="background: rgba(0,196,106,0.1); border: 1px solid rgba(0,196,106,0.3); border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
              <p style="color: #7B8094; margin: 0 0 8px 0; font-size: 14px;">Customer OTP</p>
              <h1 style="color: #00C46A; margin: 0; font-size: 48px; letter-spacing: 8px;">${otp}</h1>
            </div>
            <div style="margin: 20px 0; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Customer:</strong> ${booking.customerName}</p>
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Phone:</strong> ${booking.customerPhone}</p>
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Email:</strong> ${booking.customerEmail}</p>
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Address:</strong> ${booking.customerAddress}</p>
              <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Work:</strong> ${booking.workDescription}</p>
            </div>
          </div>
        </div>
      `
    };

    // Send emails
    try {
      await transporter.sendMail(customerMailOptions);
      console.log(`OTP email sent to customer: ${booking.customerEmail}`);
    } catch (emailErr) {
      console.error("Failed to send email to customer:", emailErr);
    }

    try {
      await transporter.sendMail(providerMailOptions);
      console.log(`OTP email sent to provider: ${provider.email}`);
    } catch (emailErr) {
      console.error("Failed to send email to provider:", emailErr);
    }

    res.json({ msg: "Booking accepted. OTP sent to customer email.", otp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/reject - Reject a booking
app.post("/api/bookings/:id/reject", authenticateToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    booking.status = "rejected";
    await booking.save();

    res.json({ msg: "Booking rejected." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings/:id/complete - Mark booking as completed (user only)
app.post("/api/bookings/:id/complete", authenticateUser, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('provider');
    if (!booking) {
      return res.status(404).json({ msg: "Booking not found" });
    }

    // Verify the booking belongs to the logged-in user
    if (booking.customer && booking.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Not authorized to complete this booking" });
    }

    booking.status = "completed";
    booking.completedAt = new Date();
    await booking.save();

    // Send notification email to provider
    if (booking.provider && booking.provider.email) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: booking.provider.email,
          subject: "HITECH - Work Marked as Completed",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0B0F; color: #F0F1F5;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #00C46A; font-family: 'Syne', sans-serif;">HITECH</h1>
              </div>
              <div style="background: #1A1D27; padding: 30px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.07);">
                <h2 style="color: #fff; margin-bottom: 10px;">Work Completed! ✅</h2>
                <p style="color: #7B8094; margin-bottom: 20px;">The customer has marked the following work as completed:</p>
                <div style="margin: 20px 0; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                  <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Work:</strong> ${booking.workDescription}</p>
                  <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Customer:</strong> ${booking.customerName}</p>
                  <p style="margin: 5px 0; color: #7B8094;"><strong style="color: #F0F1F5;">Address:</strong> ${booking.customerAddress}</p>
                </div>
                <p style="color: #7B8094; font-size: 13px;">Your completed jobs count has been updated.</p>
              </div>
            </div>
          `
        });
        console.log(`Completion email sent to provider: ${booking.provider.email}`);
      } catch (emailErr) {
        console.error("Failed to send email to provider:", emailErr);
      }
    }

    res.json({ msg: "Booking marked as completed." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings-by-phone/:phone - Get bookings by customer phone
app.get("/api/bookings-by-phone/:phone", async (req, res) => {
  try {
    const bookings = await Booking.find({ customerPhone: req.params.phone }).populate('provider').sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /track-booking - Customer booking status tracking page (protected)
app.get("/track-booking", authenticateUser, async (req, res) => {
  try {
    const bookings = await Booking.find({ customer: req.user._id }).populate('provider').sort({ createdAt: -1 });
    res.render("track-booking", { bookings });
  } catch (err) {
    console.error(err);
    res.render("track-booking", { bookings: [] });
  }
});

// GET /logout - Logout user and clear cookie
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

app.listen(5000, () => console.log("Server running on port 5000"));

// ════ SUPER ADMIN ROUTES ════

// POST /superadmin/login - SuperAdmin login
app.post("/superadmin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ msg: "Username and password required" });
    }
    const admin = await SuperAdmin.findOne({ username });
    if (!admin) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    const token = jwt.sign(
      { id: admin._id, role: "superadmin" },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ msg: "Login successful", redirect: "/superadmin/dashboard" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /superadmin - SuperAdmin login page
app.get("/superadmin", (req, res) => {
  res.render("superadmin-login");
});

// GET /superadmin/dashboard - List pending providers (protected)
app.get("/superadmin/dashboard", async (req, res) => {
  try {
    // Simple auth check (for now, just check if there's a valid admin token)
    const token = req.cookies.token;
    if (!token) return res.redirect("/superadmin");
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    if (decoded.role !== "superadmin") return res.redirect("/superadmin");

    const pendingProviders = await Provider.find({ status: "pending" }).sort({ createdAt: -1 });
    const approvedProviders = await Provider.find({ status: "approved" }).sort({ createdAt: -1 });
    const rejectedProviders = await Provider.find({ status: "rejected" }).sort({ createdAt: -1 });

    res.render("superadmin-dashboard", { pendingProviders, approvedProviders, rejectedProviders });
  } catch (err) {
    res.redirect("/superadmin");
  }
});

// POST /superadmin/approve/:id - Approve a provider
app.post("/superadmin/approve/:id", async (req, res) => {
  try {
    const provider = await Provider.findById(req.params.id);
    if (!provider) {
      return res.status(404).json({ msg: "Provider not found" });
    }

    provider.status = "approved";
    await provider.save();

    // Send approval email
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: provider.email,
        subject: "URBAN SEVAK - Your Application is Approved!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0B0F; color: #F0F1F5;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #00C46A; font-family: 'Syne', sans-serif;">URBAN SEVAK</h1>
            </div>
            <div style="background: #1A1D27; padding: 30px; border-radius: 14px; border: 1px solid rgba(0,196,106,0.3);">
              <h2 style="color: #fff; margin-bottom: 10px;">✅ Application Approved!</h2>
              <p style="color: #7B8094; margin-bottom: 20px;">
                Congratulations! Your application to join URBAN SEVAK as a service provider has been approved.
              </p>
              <div style="background: rgba(0,196,106,0.1); border: 1px solid rgba(0,196,106,0.3); border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <p style="color: #7B8094; margin: 0 0 8px 0; font-size: 14px;">You can now login using your credentials</p>
                <a href="${process.env.BASE_URL || 'http://localhost:5000'}/providerlogin" style="display: inline-block; padding: 12px 32px; background: #00C46A; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700; margin-top: 12px;">Login Now</a>
              </div>
            </div>
          </div>
        `
      });
      console.log(`Approval email sent to: ${provider.email}`);
    } catch (emailErr) {
      console.error("Failed to send approval email:", emailErr);
    }

    res.json({ msg: "Provider approved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /superadmin/reject/:id - Reject a provider
app.post("/superadmin/reject/:id", async (req, res) => {
  try {
    const { reason } = req.body;
    const provider = await Provider.findById(req.params.id);
    if (!provider) {
      return res.status(404).json({ msg: "Provider not found" });
    }

    provider.status = "rejected";
    provider.rejectionReason = reason || "No reason provided";
    await provider.save();

    // Send rejection email
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: provider.email,
        subject: "URBAN SEVAK - Application Update",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0B0F; color: #F0F1F5;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #00C46A; font-family: 'Syne', sans-serif;">URBAN SEVAK</h1>
            </div>
            <div style="background: #1A1D27; padding: 30px; border-radius: 14px; border: 1px solid rgba(231,76,60,0.3);">
              <h2 style="color: #fff; margin-bottom: 10px;">❌ Application Not Approved</h2>
              <p style="color: #7B8094; margin-bottom: 20px;">
                Unfortunately, your application to join URBAN SEVAK as a service provider was not approved at this time.
              </p>
              <div style="background: rgba(231,76,60,0.1); border: 1px solid rgba(231,76,60,0.3); border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="color: #7B8094; margin: 0 0 8px 0; font-size: 14px;">Reason:</p>
                <p style="color: #fff; margin: 8px 0 0 0;">${provider.rejectionReason}</p>
              </div>
              <p style="color: #7B8094; font-size: 13px; margin-top: 20px;">
                You may reapply after addressing the issues mentioned above.
              </p>
            </div>
          </div>
        `
      });
      console.log(`Rejection email sent to: ${provider.email}`);
    } catch (emailErr) {
      console.error("Failed to send rejection email:", emailErr);
    }

    res.json({ msg: "Provider rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

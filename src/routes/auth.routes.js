// src/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  sendOtpEmail,
  sendAdminSignupApprovalEmail,
} from "../services/mailService.js";
import User from "../models/User.js";

const router = express.Router();

/* ======================================
   Allowed domain helper
====================================== */
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "@cloud.neduet.edu.pk";
const MASTER_ADMIN_EMAIL =
  process.env.MASTER_ADMIN_EMAIL || "saleem4602545@cloud.neduet.edu.pk";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const onlyAllowedDomain = (email) =>
  !ALLOWED_DOMAIN ||
  normalizeEmail(email).endsWith(ALLOWED_DOMAIN.toLowerCase());

const safeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.otp;
  delete obj.otpExpires;
  return obj;
};

const buildAdminApprovalUrls = (userId) => {
  const approvalToken = jwt.sign(
    {
      type: "admin_signup_approval",
      userId: userId.toString(),
    },
    process.env.JWT_SECRET,
    { expiresIn: "2d" }
  );

  return {
    approveUrl: `${BACKEND_URL}/api/auth/admin-signup/approve?token=${approvalToken}`,
    rejectUrl: `${BACKEND_URL}/api/auth/admin-signup/reject?token=${approvalToken}`,
  };
};

const findApprovedAdminByEmail = async (email) => {
  return User.findOne({
    email: normalizeEmail(email),
    role: "admin",
    isVerified: true,
    $or: [
      { approvalStatus: "approved" },
      { approvalStatus: { $exists: false } },
    ],
  });
};

/* ===========================
   GET /auth/admin-signup/approve
=========================== */
router.get("/admin-signup/approve", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("Missing approval token");

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type !== "admin_signup_approval") {
      return res.status(400).send("Invalid approval token");
    }

    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).send("Admin signup request not found");

    if (user.role !== "admin") {
      return res.status(400).send("This request is not for an admin user");
    }

    if (user.approvalStatus === "approved") {
      return res.send("This admin account is already approved.");
    }

    if (user.approvalStatus !== "pending") {
      return res.status(400).send("This admin request is not pending.");
    }

    user.approvalStatus = "approved";
    user.isVerified = true;
    user.approvedAt = new Date();

    await user.save();

    return res.send(`
      <h2>Admin signup approved successfully.</h2>
      <p>${user.email} can now log in.</p>
    `);
  } catch (err) {
    console.error("Admin approval error:", err.message);
    return res.status(400).send("Invalid or expired approval link");
  }
});

/* ===========================
   GET /auth/admin-signup/reject
=========================== */
router.get("/admin-signup/reject", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("Missing rejection token");

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type !== "admin_signup_approval") {
      return res.status(400).send("Invalid rejection token");
    }

    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).send("Admin signup request not found");

    if (user.role !== "admin") {
      return res.status(400).send("This request is not for an admin user");
    }

    if (user.approvalStatus !== "pending") {
      return res.status(400).send("This admin request is not pending.");
    }

    const email = user.email;
    await User.deleteOne({ _id: user._id });

    return res.send(`
      <h2>Admin signup rejected.</h2>
      <p>${email} was not created as an admin user.</p>
    `);
  } catch (err) {
    console.error("Admin rejection error:", err.message);
    return res.status(400).send("Invalid or expired rejection link");
  }
});

/* ===========================
   GET /auth/admins (✅ ADDED: Fetch admins for the frontend signup dropdown)
=========================== */
router.get("/admins", async (req, res) => {
  try {
    // Fetch all approved admin users
    const admins = await User.find({
      role: "admin",
      isVerified: true,
      $or: [
        { approvalStatus: "approved" },
        { approvalStatus: { $exists: false } },
      ],
    }).select("name email role");

    res.status(200).json({
      success: true,
      admins,
    });
  } catch (error) {
    console.error("❌ Error fetching admins:", error);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
});

/* ===========================
   GET /auth/me  (JWT → user)
=========================== */
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    delete user.password;
    delete user.otp;
    delete user.otpExpires;

    return res.json({ user });
  } catch (err) {
    console.error("GET /auth/me error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
});

/* ===========================
   PUT /auth/me
=========================== */
router.put("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Missing token" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, phoneNumber, discipline, semester, rollNo } = req.body;

    user.name = name ?? user.name;
    user.phoneNumber = phoneNumber ?? user.phoneNumber;
    user.discipline = discipline ?? user.discipline;
    user.semester = semester ?? user.semester;
    user.rollNo = rollNo ?? user.rollNo;

    await user.save();

    const userObj = safeUser(user);

    return res.json({
      success: true,
      message: "Profile updated successfully",
      user: userObj,
    });
  } catch (err) {
    console.error("PUT /auth/me error:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
});

/* ===========================
   POST /auth/request-otp
=========================== */
router.post("/request-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (!onlyAllowedDomain(email)) {
      return res
        .status(403)
        .json({ message: `Only ${ALLOWED_DOMAIN} emails are allowed` });
    }

    let user = await User.findOne({ email });

    if (user?.approvalStatus === "pending") {
      return res.status(409).json({
        message: "Your signup request is already pending approval.",
      });
    }

    if (
      user?.approvalStatus === "approved" ||
      (user?.isVerified && !user?.approvalStatus)
    ) {
      return res.status(409).json({
        message: "User already exists. Please login.",
      });
    }

    if (user?.approvalStatus === "rejected") {
      await User.deleteOne({ _id: user._id });
      user = null;
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000)).padStart(
      6,
      "0"
    );
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    if (!user) {
      user = new User({
        name: email.split("@")[0],
        email,
        password,
        isVerified: false,
        otp,
        otpExpires,
        role: "student",
        approvalStatus: "incomplete",
      });
    } else {
      user.password = password;
      user.otp = otp;
      user.otpExpires = otpExpires;
      user.approvalStatus = "incomplete";
    }

    await user.save();

    await sendOtpEmail(email, otp);

    return res.json({ ok: true, message: "OTP sent" });
  } catch (err) {
    console.error("request-otp error:", err);
    return res.status(500).json({ message: "Could not send OTP" });
  }
});

/* ===========================
   POST /auth/verify-otp
=========================== */
router.post("/verify-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").replace(/\D/g, "").trim();

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otp || !user.otpExpires) {
      return res.status(400).json({ message: "No OTP requested" });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ message: "OTP expired" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;

    await user.save();

    return res.json({ ok: true, message: "OTP verified" });
  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ message: "Could not verify OTP" });
  }
});

/* ===========================
   POST /auth/register
=========================== */
router.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { name, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const newUser = new User({
      name,
      email,
      password,
      role: role || "student",
    });

    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(201).json({
      message: "User registered successfully",
      token,
      role: newUser.role,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* ===========================
   POST /auth/login
=========================== */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.password) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    let isMatch = false;
    const storedPassword = String(user.password || "");

    // Normal existing functionality: hashed password login
    if (
      storedPassword.startsWith("$2a$") ||
      storedPassword.startsWith("$2b$") ||
      storedPassword.startsWith("$2y$")
    ) {
      isMatch = await bcrypt.compare(password, storedPassword);
    }

    // Extra fix only for old Google signup accounts saved with plain password
    if (!isMatch && storedPassword === String(password)) {
      isMatch = true;

      const fixedHash = await bcrypt.hash(String(password), 10);

      await User.updateOne(
        { _id: user._id },
        { $set: { password: fixedHash } }
      );
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res.status(400).json({ message: "Please verify your email first" });
    }

    const approvalStatus = user.approvalStatus || "approved";

    if (approvalStatus === "incomplete") {
      return res.status(403).json({
        message: "Please complete your signup profile first.",
      });
    }

    if (approvalStatus === "pending") {
      return res.status(403).json({
        message: "Your signup request is waiting for approval.",
      });
    }

    if (approvalStatus === "rejected") {
      return res.status(403).json({
        message: "Your signup request was rejected.",
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({
      message: "Login successful",
      token,
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* ===========================
   POST /auth/register/complete
=========================== */
router.post("/register/complete", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    const {
      fullName,
      role,
      discipline,
      batch,
      rollNo,
      phoneNumber,
      semester,
      dateOfJoining,
      supervisorEmail,
    } = req.body;

    const normalizedSupervisorEmail = normalizeEmail(supervisorEmail);

    if (!email || !fullName) {
      return res.status(400).json({ message: "Email and full name are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isVerified) {
      return res.status(400).json({ message: "User not found or not verified" });
    }

    if (user.approvalStatus === "pending") {
      return res.status(409).json({
        message: "Your signup request is already pending approval.",
      });
    }

    if (user.approvalStatus === "approved") {
      return res.status(409).json({
        message: "User already exists. Please login.",
      });
    }

    const requestedRole = role === "admin" ? "admin" : "student";

    if (
      requestedRole === "student" &&
      (!discipline || !batch || !rollNo || !normalizedSupervisorEmail)
    ) {
      return res.status(400).json({
        message:
          "Discipline, batch, roll number, and supervisor/admin email are required for students.",
      });
    }

    if (requestedRole === "student" && !onlyAllowedDomain(normalizedSupervisorEmail)) {
      return res.status(400).json({
        message: `Supervisor/admin email must be a ${ALLOWED_DOMAIN} address.`,
      });
    }

    if (requestedRole === "student") {
      const supervisorAdmin = await findApprovedAdminByEmail(normalizedSupervisorEmail);

      if (!supervisorAdmin) {
        return res.status(400).json({
          message:
            "Supervisor/admin email was not found as an approved admin account.",
        });
      }
    }

    user.name = String(fullName).trim();
    user.role = requestedRole;
    user.phoneNumber = phoneNumber || undefined;
    user.approvalStatus = "pending";
    user.approvalRequestedAt = new Date();
    user.approvedAt = undefined;
    user.approvedBy = undefined;

    if (requestedRole === "student") {
      user.supervisorEmail = normalizedSupervisorEmail;
      user.discipline = discipline || undefined;
      user.batch = batch || undefined;
      user.rollNo = rollNo || undefined;
      user.semester = semester || undefined;
      user.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : undefined;
    } else {
      user.supervisorEmail = undefined;
      user.discipline = undefined;
      user.batch = undefined;
      user.rollNo = undefined;
      user.semester = undefined;
      user.dateOfJoining = undefined;
    }

    await user.save();

    if (requestedRole === "admin") {
      const { approveUrl, rejectUrl } = buildAdminApprovalUrls(user._id);

      await sendAdminSignupApprovalEmail({
        to: MASTER_ADMIN_EMAIL,
        user,
        approveUrl,
        rejectUrl,
      });

      return res.json({
        ok: true,
        pendingApproval: true,
        role: user.role,
        message:
          "Admin signup request sent for approval. You can login after it is approved.",
      });
    }

    return res.json({
      ok: true,
      pendingApproval: true,
      role: user.role,
      message:
        "Student signup request sent to the selected supervisor/admin for approval. You can login after approval.",
      user: safeUser(user),
    });
  } catch (err) {
    console.error("register/complete error:", err);
    return res.status(500).json({ message: "Could not complete registration" });
  }
});

export default router;
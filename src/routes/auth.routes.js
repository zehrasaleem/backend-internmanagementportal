// src/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendOtpEmail } from "../services/mailService.js";
import User from "../models/User.js";

const router = express.Router();

/* ======================================
   Allowed domain helper (optional)
====================================== */
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "@cloud.neduet.edu.pk";
const onlyAllowedDomain = (email) =>
  !ALLOWED_DOMAIN || email.toLowerCase().endsWith(ALLOWED_DOMAIN.toLowerCase());

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

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.otp;
    delete userObj.otpExpires;

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
    const rawEmail = req.body.email || "";
    const email = String(rawEmail).trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (!onlyAllowedDomain(email)) {
      return res.status(403).json({ message: `Only ${ALLOWED_DOMAIN} emails are allowed` });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000)).padStart(6, "0");
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    let user = await User.findOne({ email });

    if (user && user.isVerified) {
      return res.status(409).json({ message: "User already exists. Please login." });
    }

    if (!user) {
      user = new User({
        name: email.split("@")[0],
        email,
        password,
        isVerified: false,
        otp,
        otpExpires,
        role: "student",
      });
    } else {
      user.password = password;
      user.otp = otp;
      user.otpExpires = otpExpires;
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
    const rawEmail = req.body.email || "";
    const email = String(rawEmail).trim().toLowerCase();
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
    const { name, email, password, role } = req.body;

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
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

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
    const email = String(req.body.email || "").trim().toLowerCase();

    const {
      fullName,
      role,
      discipline,
      batch,
      rollNo,
      phoneNumber,
      semester,
      dateOfJoining,
    } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ message: "Email and full name are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isVerified) {
      return res.status(400).json({ message: "User not found or not verified" });
    }

    user.name = String(fullName).trim();
    user.role = role || "student";
    user.phoneNumber = phoneNumber || undefined;

    if (user.role === "student") {
      user.discipline = discipline || undefined;
      user.batch = batch || undefined;
      user.rollNo = rollNo || undefined;
      user.semester = semester || undefined;
      user.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : undefined;
    } else {
      user.discipline = undefined;
      user.batch = undefined;
      user.rollNo = undefined;
      user.semester = undefined;
      user.dateOfJoining = undefined;
    }

    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({
      ok: true,
      message: "Profile completed",
      role: user.role,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        picture: user.picture,
        discipline: user.discipline,
        batch: user.batch,
        rollNo: user.rollNo,
        phoneNumber: user.phoneNumber,
        semester: user.semester,
        dateOfJoining: user.dateOfJoining,
      },
    });
  } catch (err) {
    console.error("register/complete error:", err);
    return res.status(500).json({ message: "Could not complete registration" });
  }
});

export default router;
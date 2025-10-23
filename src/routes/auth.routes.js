// src/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import User from "../models/User.js";

const router = express.Router();

/* ======================================
   Email transport (uses your .env)
====================================== */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: String(process.env.SMTP_SECURE) === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

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

    const payload = jwt.verify(token, process.env.JWT_SECRET); // { id, role }
    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // never send password/otp
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
        email,
        password,       // raw; model pre-save will hash
        isVerified: false,
        otp,
        otpExpires,
      });
    } else {
      user.password = password; // raw; model will hash
      user.otp = otp;
      user.otpExpires = otpExpires;
    }

    await user.save();

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Your verification code",
      text: `Your verification code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <b>${otp}</b>. It expires in 10 minutes.</p>`,
    });

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
   (Basic create; model pre-save hashes)
=========================== */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const newUser = new User({
      name,
      email,
      password,         // raw; model hashes automatically
      role: role || "student",
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id, role: newUser.role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

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

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

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
   (NORMAL SIGNUP: Persist ALL profile fields into User)
=========================== */
router.post("/register/complete", async (req, res) => {
  try {
    // normalize email
    const email = String(req.body.email || "").trim().toLowerCase();

    const {
      fullName,
      role,
      discipline,
      batch,
      rollNo,
      phoneNumber,
      semester,
      dateOfJoining, // "YYYY-MM-DD" from <input type="date">
    } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ message: "Email and full name are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isVerified) {
      return res.status(400).json({ message: "User not found or not verified" });
    }

    // Always set these
    user.name = String(fullName).trim();
    user.role = role || "student";
    user.phoneNumber = phoneNumber || undefined;

    if (user.role === "student") {
      // Save ALL student fields
      user.discipline = discipline || undefined;
      user.batch = batch || undefined;
      user.rollNo = rollNo || undefined;
      user.semester = semester || undefined;
      user.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : undefined;
    } else {
      // Admin: clear student-only data
      user.discipline = undefined;
      user.batch = undefined;
      user.rollNo = undefined;
      user.semester = undefined;
      user.dateOfJoining = undefined;
    }

    await user.save();

    // ⬇ return a fresh JWT + sanitized user object
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

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

// src/routes/googleAuth.js
import express from "express";
import axios from "axios";
import querystring from "querystring";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

// ✅ Debug route to confirm router is loaded
router.get("/test", (req, res) => {
  res.send("✅ googleAuth router is connected");
});


/* ================================
   1) Start Google OAuth
================================ */
router.get("/", (req, res) => {
  const redirectUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
    `redirect_uri=http://localhost:5000/api/google/callback&` + // <-- updated
    `response_type=code&` +
    `scope=openid%20email%20profile&` +
    `access_type=offline`;

  res.redirect(redirectUrl);
});

/* =========================================================
   2) Google callback → verify domain → set signup cookie
========================================================= */
router.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code returned from Google");

  try {
    // Exchange code for tokens
    const { data } = await axios.post(
      "https://oauth2.googleapis.com/token",
      querystring.stringify({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: "http://localhost:5000/api/google/callback", // <-- updated
        grant_type: "authorization_code",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // Fetch user info
    const { data: userInfo } = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );

    // Restrict domain
    const allowedDomain = (process.env.GOOGLE_ALLOWED_DOMAIN || "@cloud.neduet.edu.pk").toLowerCase();
    if (!userInfo.email.toLowerCase().endsWith(allowedDomain)) {
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";
      const params = new URLSearchParams({ reason: "domain" });
      return res.redirect(`${FRONTEND_URL}/signup-fail?${params.toString()}`);
    }

    // Short-lived signup token (cookie)
    const signupToken = jwt.sign(
      {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        googleId: userInfo.id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    res.cookie("signup_token", signupToken, {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      maxAge: 10 * 60 * 1000,
    });

    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";
    return res.redirect(`${FRONTEND_URL}/google-signup`);
  } catch (err) {
    console.error("❌ Google OAuth error:", err.response?.data || err.message);
    return res.status(500).send("Google login failed");
  }
});

/* =========================================================
   3) Prefill name/email from the signup cookie
========================================================= */
router.get("/signup-info", (req, res) => {
  try {
    const token = req.cookies?.signup_token;
    if (!token) return res.status(401).json({ message: "Signup session expired" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ email: payload.email, name: payload.name, picture: payload.picture });
  } catch {
    return res.status(401).json({ message: "Signup session expired" });
  }
});

/* =========================================================
   4) Complete signup (create/update user) and return JWT
========================================================= */
router.post("/complete", async (req, res) => {
  try {
    const token = req.cookies?.signup_token;
    if (!token) return res.status(401).json({ message: "Signup session expired" });
    const idp = jwt.verify(token, process.env.JWT_SECRET); // { email, name, picture, googleId }

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

    let user = await User.findOne({ email: idp.email });

    if (!user) {
      user = new User({
        googleId: idp.googleId,
        email: idp.email,
        name: fullName || idp.name,
        picture: idp.picture,
        isVerified: true,
        role,
      });
    } else {
      user.name = fullName || user.name || idp.name;
      user.role = role || user.role || "student";
    }

    user.phoneNumber = phoneNumber;

    if (user.role === "student") {
      user.discipline = discipline;
      user.batch = batch;
      user.rollNo = rollNo;
      user.semester = semester;
      user.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : undefined;
    } else {
      user.discipline = undefined;
      user.batch = undefined;
      user.rollNo = undefined;
      user.semester = undefined;
      user.dateOfJoining = undefined;
    }

    await user.save();

    // Issue JWT
    const appToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Clear cookie
    res.clearCookie("signup_token", {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
    });

    return res.json({ ok: true, role: user.role, user, token: appToken });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Could not complete signup" });
  }
});

export default router;

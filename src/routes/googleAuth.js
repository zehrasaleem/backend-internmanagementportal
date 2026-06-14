// src/routes/googleAuth.js
import express from "express";
import axios from "axios";
import querystring from "querystring";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { sendAdminSignupApprovalEmail } from "../services/mailService.js";

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";
const GOOGLE_CALLBACK_URL = `${BACKEND_URL}/api/google/callback`;

const MASTER_ADMIN_EMAIL =
  process.env.MASTER_ADMIN_EMAIL || "saleem4602545@cloud.neduet.edu.pk";

const ALLOWED_DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAIN || "@cloud.neduet.edu.pk";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const onlyAllowedDomain = (email) =>
  !ALLOWED_DOMAIN ||
  normalizeEmail(email).endsWith(ALLOWED_DOMAIN.toLowerCase());

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

const clearSignupCookie = (res) => {
  res.clearCookie("signup_token", {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
  });
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

/* ==============================
   0) Debug route
============================== */
router.get("/test", (req, res) => {
  res.send("✅ googleAuth router is connected");
});

/* ==============================
   1) Start Google OAuth
============================== */
router.get("/", (req, res) => {
  const redirectUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GOOGLE_CALLBACK_URL)}&` +
    `response_type=code&` +
    `scope=openid%20email%20profile&` +
    `access_type=offline`;

  res.redirect(redirectUrl);
});

/* ==============================
   2) Google callback
============================== */
router.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("No code returned from Google");
  }

  try {
    const { data } = await axios.post(
      "https://oauth2.googleapis.com/token",
      querystring.stringify({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: "authorization_code",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { data: userInfo } = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      }
    );

    const allowedDomain = (
      process.env.GOOGLE_ALLOWED_DOMAIN || "@cloud.neduet.edu.pk"
    ).toLowerCase();

    const googleEmail = normalizeEmail(userInfo.email);

    if (!googleEmail.endsWith(allowedDomain)) {
      const params = new URLSearchParams({ reason: "domain" });
      return res.redirect(`${FRONTEND_URL}/signup-fail?${params.toString()}`);
    }

    const signupToken = jwt.sign(
      {
        email: googleEmail,
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

    return res.redirect(`${FRONTEND_URL}/google-signup`);
  } catch (err) {
    console.error(
      "❌ Google OAuth error:",
      err.response?.data || err.message,
      err.stack
    );

    return res.status(500).send("Google signup failed");
  }
});

/* ==============================
   3) Signup info
============================== */
router.get("/signup-info", (req, res) => {
  try {
    const token = req.cookies?.signup_token;

    if (!token) {
      return res.status(401).json({
        message: "Signup session expired",
      });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    return res.json({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    });
  } catch (err) {
    console.error("Signup info error:", err.message);

    return res.status(401).json({
      message: "Signup session expired",
    });
  }
});

/* ==============================
   4) Complete Google signup
   IMPORTANT:
   This only creates pending request.
   It does NOT login user.
   It does NOT return token.
============================== */
router.post("/complete", async (req, res) => {
  try {
    const token = req.cookies?.signup_token;

    if (!token) {
      return res.status(401).json({
        message: "Signup session expired",
      });
    }

    const idp = jwt.verify(token, process.env.JWT_SECRET);

    const {
      fullName,
      role,
      password,
      discipline,
      batch,
      rollNo,
      phoneNumber,
      semester,
      dateOfJoining,
      supervisorEmail,
    } = req.body;

    const googleEmail = normalizeEmail(idp.email);
    const normalizedSupervisorEmail = normalizeEmail(supervisorEmail);

    if (!fullName || !role) {
      return res.status(400).json({
        message: "Full name and role are required",
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
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

    if (
      requestedRole === "student" &&
      !onlyAllowedDomain(normalizedSupervisorEmail)
    ) {
      return res.status(400).json({
        message: `Supervisor/admin email must be a ${ALLOWED_DOMAIN} address.`,
      });
    }

    if (requestedRole === "student") {
      const supervisorAdmin = await findApprovedAdminByEmail(
        normalizedSupervisorEmail
      );

      if (!supervisorAdmin) {
        return res.status(400).json({
          message:
            "Supervisor/admin email was not found as an approved admin account.",
        });
      }
    }

    let user = await User.findOne({ email: googleEmail });

    if (user && (user.approvalStatus || "approved") === "approved") {
      clearSignupCookie(res);

      return res.status(409).json({
        message:
          "This account is already approved. Please login using the normal email/password login form.",
      });
    }

    if (user?.approvalStatus === "pending") {
      clearSignupCookie(res);

      return res.status(409).json({
        message:
          "Your signup request is already pending approval. Please login after approval.",
      });
    }

    if (user?.approvalStatus === "rejected") {
      await User.deleteOne({ _id: user._id });
      user = null;
    }

    /*
      IMPORTANT:
      Do NOT bcrypt.hash here.
      User.js already hashes password in userSchema.pre("save").
    */
    if (!user) {
      user = new User({
        googleId: idp.googleId,
        email: googleEmail,
        name: fullName.trim() || idp.name,
        password: password,
        picture: idp.picture,
        isVerified: true,
        role: requestedRole,
      });
    } else {
      user.googleId = user.googleId || idp.googleId;
      user.picture = user.picture || idp.picture;
      user.name = fullName.trim() || user.name || idp.name;
      user.password = password;
      user.role = requestedRole;
      user.isVerified = true;
    }

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

      if (dateOfJoining) {
        const doj = new Date(dateOfJoining);
        user.dateOfJoining = !isNaN(doj.getTime()) ? doj : undefined;
      } else {
        user.dateOfJoining = undefined;
      }
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

      clearSignupCookie(res);

      return res.json({
        ok: true,
        pendingApproval: true,
        role: user.role,
        message:
          "Admin signup request sent to the main admin for approval. You can login with normal email/password after approval.",
      });
    }

    clearSignupCookie(res);

    return res.json({
      ok: true,
      pendingApproval: true,
      role: user.role,
      message:
        "Student signup request sent to the selected supervisor/admin for approval. You can login with normal email/password after approval.",
    });
  } catch (err) {
    console.error("Google signup complete error:", err.message, err.stack);

    return res.status(500).json({
      message: "Could not complete signup",
      error: err.message,
    });
  }
});

export default router;
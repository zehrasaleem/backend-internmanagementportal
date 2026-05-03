// src/routes/user.routes.js
import express from "express";
import mongoose from "mongoose";
import User, { getAllStudents } from "../models/User.js";
import Project from "../models/project.js";
import Task from "../models/Task.js";
import Timetable from "../models/timetable.js";
import Attendance from "../models/Attendance.js";
import protect from "../middleware/auth.js";
import { sendOtpEmail } from "../services/mailService.js";

const router = express.Router();

/* ----------------------------- config & helpers ----------------------------- */
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "@cloud.neduet.edu.pk").toLowerCase();
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();
const isValidEmailDomain = (email) => normalizeEmail(email).endsWith(ALLOWED_DOMAIN);

/* ------------------- SIGNUP (send OTP by email) ------------------- */
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const normEmail = normalizeEmail(email);
    if (!isValidEmailDomain(normEmail)) {
      return res.status(400).json({ message: `Email must be a ${ALLOWED_DOMAIN} address` });
    }

    let user = await User.findOne({ email: normEmail });
    if (user) return res.status(400).json({ message: "User already exists" });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Create new user (password hashed automatically in schema)
    user = new User({
      name,
      email: normEmail,
      password,
      isVerified: false,
      otp,
      otpExpires: Date.now() + 10 * 60 * 1000, // 10 mins
    });
    await user.save();

    // Send OTP via email
    try {
      await sendOtpEmail(normEmail, otp);
      console.log(`📧 OTP emailed to ${normEmail}`);
    } catch (mailErr) {
      console.error("Email send failed:", mailErr?.message || mailErr);
      return res.status(500).json({ error: "Signup created, but failed to send OTP email." });
    }

    return res.status(201).json({ message: "Signup successful. OTP sent to your email." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Signup failed" });
  }
});

/* --------------------------- VERIFY OTP ---------------------------- */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const normEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normEmail });
    if (!user) return res.status(400).json({ message: "User not found" });
    if (user.isVerified) return res.status(400).json({ message: "User already verified" });

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    return res.json({ message: "User verified successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "OTP verification failed" });
  }
});

/* ------------------ LOGIN (only verified users) -------------------- */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const normEmail = normalizeEmail(email);
    if (!isValidEmailDomain(normEmail)) {
      return res.status(400).json({ message: `Email must be a ${ALLOWED_DOMAIN} address` });
    }

    const user = await User.findOne({ email: normEmail }).select("+password");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.isVerified) {
      return res.status(400).json({ message: "Please verify your email first" });
    }

    const userObj = user.toObject();
    delete userObj.password;

    return res.json({ message: "Login successful", user: userObj });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/* --------------------------- GET ALL USERS ------------------------- */
router.get("/", async (_req, res) => {
  try {
    const users = await User.find(); // password hidden by default
    return res.json(users);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/students", getAllStudents);

/* ---------------------- GET SINGLE STUDENT PROFILE ---------------------- */
router.get("/students/:id", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin can view intern profiles",
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid intern id",
      });
    }

    const student = await User.findOne({ _id: id, role: "student" }).select(
      "_id name email picture discipline batch rollNo phoneNumber semester dateOfJoining"
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Intern not found",
      });
    }

    return res.status(200).json({
      success: true,
      student,
    });
  } catch (error) {
    console.error("❌ Error fetching intern profile:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch intern profile",
    });
  }
});

/* ---------------------- REMOVE INTERN FROM SYSTEM ---------------------- */
router.delete("/students/:id", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin can remove interns",
      });
    }

    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid intern id",
      });
    }

    const intern = await User.findOne({ _id: id, role: "student" });

    if (!intern) {
      return res.status(404).json({
        success: false,
        message: "Intern not found",
      });
    }

    // Remove intern from projects only. Do not delete projects.
    const projectUpdateResult = await Project.updateMany(
      { assignedTo: id },
      { $pull: { assignedTo: id } }
    );

    // If a task has only this intern, delete the task.
    // If a task has multiple interns, only remove this intern from assignedTo.
    const tasksWithIntern = await Task.find({ assignedTo: id }).select("_id assignedTo");

    const taskIdsToDelete = tasksWithIntern
      .filter((task) => task.assignedTo.length <= 1)
      .map((task) => task._id);

    let deletedTasksCount = 0;

    if (taskIdsToDelete.length > 0) {
      const deletedTasks = await Task.deleteMany({
        _id: { $in: taskIdsToDelete },
      });
      deletedTasksCount = deletedTasks.deletedCount || 0;
    }

    const taskUpdateResult = await Task.updateMany(
      {
        assignedTo: id,
        _id: { $nin: taskIdsToDelete },
      },
      { $pull: { assignedTo: id } }
    );

    const timetableDeleteResult = await Timetable.deleteMany({ student: id });
    const attendanceDeleteResult = await Attendance.deleteMany({ student: id });

    await User.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: "Intern removed successfully",
      cleanup: {
        projectsUpdated: projectUpdateResult.modifiedCount || 0,
        tasksUpdated: taskUpdateResult.modifiedCount || 0,
        tasksDeleted: deletedTasksCount,
        timetablesDeleted: timetableDeleteResult.deletedCount || 0,
        attendanceDeleted: attendanceDeleteResult.deletedCount || 0,
      },
    });
  } catch (error) {
    console.error("❌ Error removing intern:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove intern",
    });
  }
});

export default router;
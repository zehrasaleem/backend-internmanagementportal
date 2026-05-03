import express from "express";
import auth from "../middleware/auth.js";
import {
  getMyTodayMeetings,
  markAttendance,
  getMyAttendanceHistory,
  getAdminDailyReport,
} from "../controllers/attendance.controller.js";

const router = express.Router();

/**
 * STUDENT
 * GET /api/attendance/my/today
 * Shows today's scheduled meeting slots for attendance
 */
router.get("/my/today", auth, getMyTodayMeetings);

/**
 * STUDENT
 * POST /api/attendance/mark
 * Body: { slotId, latitude, longitude, accuracy }
 */
router.post("/mark", auth, markAttendance);

/**
 * STUDENT
 * GET /api/attendance/my/history
 */
router.get("/my/history", auth, getMyAttendanceHistory);

/**
 * ADMIN
 * GET /api/attendance/admin/daily?date=YYYY-MM-DD
 */
router.get("/admin/daily", auth, getAdminDailyReport);

export default router;
import express from "express";
import { protect } from "../middleware/auth.js";
import { getTeamLeadStudentTimetables } from "../controllers/teamlead.timetable.controller.js";

const router = express.Router();

/**
 * GET /api/teamlead/timetable/all
 * Team lead sees only their interns’ timetables
 */
router.get("/all", protect, getTeamLeadStudentTimetables);

export default router;
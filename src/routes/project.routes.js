import express from "express";
import * as projectCtrl from "../controllers/project.controller.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// 🔵 TEAM LEAD CHECK (MUST BE FIRST)
router.get(
  "/my/lead-projects",
  protect,
  projectCtrl.getMyLeadProjects
);

// CRUD
router.post("/", protect, projectCtrl.createProject);
router.get("/", protect, projectCtrl.getProjects);
router.get("/:id", protect, projectCtrl.getProject);

// Update
router.put("/:id", protect, projectCtrl.updateProject);
router.patch("/:id", protect, projectCtrl.updateProject);

// Delete
router.delete("/:id", protect, projectCtrl.deleteProject);

// Assignees
router.patch("/:id/assignees", protect, projectCtrl.modifyAssignees);

export default router;

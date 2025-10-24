import express from "express";
import * as projectCtrl from "../controllers/project.controller.js";

const router = express.Router();

// CRUD
router.post("/", projectCtrl.createProject);
router.get("/", projectCtrl.getProjects);
router.get("/:id", projectCtrl.getProject);

// accept both PUT and PATCH for convenience
router.put("/:id", projectCtrl.updateProject);
router.patch("/:id", projectCtrl.updateProject);

router.delete("/:id", projectCtrl.deleteProject);

// Assignee management (patch)
router.patch("/:id/assignees", projectCtrl.modifyAssignees);

export default router;

import express from "express";
import Task from "../models/Task.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

/* 
---------------------------------------------
📘 CREATE NEW TASK (Admin only)
---------------------------------------------
*/
router.post("/", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied. Admins only." });
  }

  try {
    const { title, description, assignedTo, dueDate, status, subHeading, project } = req.body;

    if (!title || !assignedTo?.length || !dueDate) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const users = await User.find({ email: { $in: assignedTo } });
    if (!users.length) {
      return res.status(404).json({ success: false, message: "No matching users found." });
    }

    const userIds = users.map((u) => u._id);

    const newTask = await Task.create({
      title,
      subHeading: subHeading || "",
      description: description || "",
      assignedTo: userIds,
      assignedBy: req.user._id,
      project: project || "",
      dueDate,
      status: status || "Assigned",
    });

    const populatedTask = await Task.findById(newTask._id)
      .populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" }
      ]);

    res.status(201).json({ success: true, message: "Task created successfully.", task: populatedTask });
  } catch (error) {
    console.error("❌ Error creating task:", error);
    res.status(500).json({ success: false, message: "Failed to create task", error: error.message });
  }
});

/* 
---------------------------------------------
📗 GET ALL TASKS (Admin)
---------------------------------------------
*/
router.get("/", async (req, res) => {
  try {
    const tasks = await Task.find()
      .populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" }
      ])
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, tasks });
  } catch (err) {
    console.error("❌ Error fetching tasks:", err);
    res.status(500).json({ success: false, message: "Error fetching tasks" });
  }
});

/* 
---------------------------------------------
📘 GET TASKS BY STUDENT EMAIL
---------------------------------------------
*/
router.get("/student/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const student = await User.findOne({ email });
    if (!student) return res.status(404).json({ success: false, message: "No user found with that email." });

    const tasks = await Task.find({ assignedTo: student._id })
      .populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" }
      ])
      .sort({ dueDate: 1 });

    res.status(200).json({ success: true, tasks });
  } catch (error) {
    console.error("❌ Error fetching student tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟡 UPDATE TASK STATUS
---------------------------------------------
*/
router.put("/:id/status", protect, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["Assigned", "In Progress", "Completed", "Pending Approval"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value." });
    }

    if (status === "Pending Approval" && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can set status to Pending Approval." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    if (status === "In Progress" && !task.startDate) task.startDate = new Date();
    if (status === "Completed" && !task.completedDate) task.completedDate = new Date();

    task.status = status;
    await task.save();

    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    res.json({ success: true, task });
  } catch (error) {
    console.error("❌ Error updating task status:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟢 UPDATE TASK PROGRESS (0–100)
---------------------------------------------
*/
router.put("/:id/progress", protect, async (req, res) => {
  try {
    const { progress } = req.body;
    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({ success: false, message: "Progress must be a number between 0–100." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    let newProgress = progress;
    if (req.user.role === "student" && progress > 90) newProgress = 90;

    if (!task.startDate) task.startDate = new Date();
    if (task.status === "Assigned") task.status = "In Progress";

    task.progress = newProgress;
    await task.save();

    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    res.json({ success: true, task });
  } catch (error) {
    console.error("❌ Error updating task progress:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟢 ASSIGN MORE STUDENTS TO EXISTING TASK (Admin only)
---------------------------------------------
*/
router.patch("/:id/assign", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied. Admins only." });
  }

  try {
    const { assignedTo } = req.body;
    if (!assignedTo?.length) return res.status(400).json({ success: false, message: "No students provided." });

    const users = await User.find({ email: { $in: assignedTo } });
    if (!users.length) return res.status(404).json({ success: false, message: "No matching users found." });

    const userIds = users.map((u) => u._id);

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { assignedTo: { $each: userIds } } },
      { new: true }
    ).populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    if (!updatedTask) return res.status(404).json({ success: false, message: "Task not found." });

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error("❌ Error assigning students:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟡 REQUEST TASK APPROVAL (Student)
---------------------------------------------
*/
router.put("/:id/request-approval", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    if (!task.assignedTo.some((id) => id.equals(req.user._id))) {
      return res.status(403).json({ success: false, message: "You are not assigned to this task." });
    }

    if ((task.progress ?? 0) < 90) {
      return res.status(400).json({ success: false, message: "You must reach at least 90% progress to request approval." });
    }

    task.status = "Pending Approval";
    await task.save();

    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    res.json({ success: true, message: "Task approval requested successfully.", task });
  } catch (error) {
    console.error("❌ Error requesting approval:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟦 FULL TASK UPDATE (Admin only)
PATCH /tasks/:id
---------------------------------------------
*/
router.patch("/:id", protect, async (req, res) => {
  try {
    // ✔ Only admin can update
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admins only.",
      });
    }

    const {
      title,
      description,
      dueDate,
      assignedTo,
      progress,
      status,
      subHeading,
      project,
    } = req.body;

    const updateData = {};

    // Only update fields if provided
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (subHeading !== undefined) updateData.subHeading = subHeading;
    if (project !== undefined) updateData.project = project;

    // ✔ Update progress (0–100)
    if (progress !== undefined) {
      if (progress < 0 || progress > 100) {
        return res.status(400).json({
          success: false,
          message: "Progress must be between 0–100.",
        });
      }
      updateData.progress = progress;
    }

    // ✔ Update status safely
    if (status !== undefined) {
      const validStatuses = [
        "Assigned",
        "In Progress",
        "Completed",
        "Pending Approval",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status value.",
        });
      }

      updateData.status = status;

      // Date auto-handling
      if (status === "In Progress") updateData.startDate = new Date();
      if (status === "Completed") updateData.completedDate = new Date();
    }

    // ✔ Replace assignedTo list
    if (assignedTo !== undefined) {
      if (!Array.isArray(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: "assignedTo must be an array of emails.",
        });
      }

      const users = await User.find({ email: { $in: assignedTo } });

      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "No matching users found.",
        });
      }

      updateData.assignedTo = users.map((u) => u._id);
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" },
    ]);

    if (!updatedTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    res.json({
      success: true,
      message: "Task updated successfully.",
      task: updatedTask,
    });
  } catch (error) {
    console.error("❌ Error updating task:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* 
---------------------------------------------
📕 DELETE TASK (Admin only)
---------------------------------------------
*/
router.delete("/:id", protect, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied. Admins only." });
  }

  try {
    const deleted = await Task.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Task not found." });

    res.json({ success: true, message: "Task deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

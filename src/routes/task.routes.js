import express from "express";
import Task from "../models/Task.js"; // ✅ fixed import path
import User from "../models/User.js"; // ✅ for finding student by email

const router = express.Router();

/* 
---------------------------------------------
📘 CREATE NEW TASK (Admin only)
---------------------------------------------
*/
router.post("/", async (req, res) => {
  try {
    const { title, description, assignedTo, dueDate, status, subHeading } = req.body;

    if (!title || !assignedTo || !dueDate) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    // ✅ Find student by email
    const student = await User.findOne({ email: assignedTo });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: `No user found with email ${assignedTo}`,
      });
    }

    // ✅ Create task using student._id
    const newTask = new Task({
      title,
      description,
      subHeading,
      assignedTo: student._id,
      dueDate,
      status: status || "Assigned",
    });

    const savedTask = await newTask.save();
    res.status(201).json({ success: true, task: savedTask });
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
📗 GET ALL TASKS (Admin)
→ Returns grouped tasks dynamically
---------------------------------------------
*/
router.get("/", async (req, res) => {
  try {
    const tasks = await Task.find()
      .populate("assignedTo", "name email") // shows student details
      .lean();

    res.json({ success: true, tasks });
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ success: false, message: "Error fetching tasks" });
  }
});

/* 
---------------------------------------------
📘 GET TASKS BY STUDENT EMAIL
→ For Student Dashboard frontend
---------------------------------------------
*/
router.get("/student/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const student = await User.findOne({ email });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: `No user found with email ${email}`,
      });
    }

    // ✅ Fetch tasks by student ObjectId
    const tasks = await Task.find({ assignedTo: student._id }).sort({
      dueDate: 1,
    });

    res.json({ success: true, tasks });
  } catch (error) {
    console.error("Error fetching student tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟡 UPDATE TASK STATUS
---------------------------------------------
*/
router.put("/:id/status", async (req, res) => {
  try {
    const { status, role } = req.body;

    // 🧩 Restrict student updates
    if (role === "student" && status === "Completed") {
      return res.status(403).json({
        success: false,
        message: "Students cannot mark tasks as Completed.",
      });
    }

    // 🧩 Validate status value
    if (!["Assigned", "In Progress", "Completed"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value" });
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updatedTask) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found" });
    }

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error("Error updating task status:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
📕 DELETE TASK (Admin)
---------------------------------------------
*/
router.delete("/:id", async (req, res) => {
  try {
    const deletedTask = await Task.findByIdAndDelete(req.params.id);
    if (!deletedTask) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found" });
    }

    res.json({ success: true, message: "Task deleted successfully" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

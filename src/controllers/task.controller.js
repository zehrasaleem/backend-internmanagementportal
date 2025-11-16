// server/controllers/task.controller.js
import Task from "../models/task.model.js";
import User from "../models/User.js";

/* 
--------------------------------------------------
📘 CREATE NEW TASK (Supports Multiple Students by Name & Saves Project Name)
--------------------------------------------------
*/
export const createTask = async (req, res) => {
  try {
    const { title, subHeading, description, assignedTo, dueDate, status, project } = req.body;

    // Validate assignedTo: should be array of student names
    if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
      return res.status(400).json({ message: "Please assign at least one student." });
    }

    // Lookup user IDs from names
    const users = await User.find({ name: { $in: assignedTo } });
    if (!users || users.length === 0) {
      return res.status(404).json({ message: "No matching students found." });
    }

    const createdTasks = [];

    for (const user of users) {
      const task = await Task.create({
        title,
        subHeading,
        description,
        assignedTo: user._id,
        dueDate,
        status: status || "Assigned",
        project: project || "",
      });
      createdTasks.push(task);
    }

    // Populate assignedTo with name/email before sending response
    const populatedTasks = await Task.find({ _id: { $in: createdTasks.map(t => t._id) } })
      .populate("assignedTo", "name email");

    res.status(201).json({
      message: "Tasks created successfully for selected students.",
      tasks: populatedTasks,
    });
  } catch (error) {
    console.error("❌ Error creating tasks:", error);
    res.status(500).json({ message: "Failed to create tasks", error: error.message });
  }
};

/* 
--------------------------------------------------
📗 GET ALL TASKS
--------------------------------------------------
*/
export const getTasks = async (req, res) => {
  try {
    const tasks = await Task.find().populate("assignedTo", "name email");
    res.status(200).json(tasks);
  } catch (error) {
    console.error("❌ Error fetching tasks:", error);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
};

/* 
--------------------------------------------------
📙 GET TASKS BY STUDENT ID
--------------------------------------------------
*/
export const getTasksByStudent = async (req, res) => {
  try {
    const { studentId } = req.params;

    const tasks = await Task.find({ assignedTo: studentId }).populate(
      "assignedTo",
      "name email"
    );

    if (!tasks || tasks.length === 0) {
      return res.status(404).json({
        message: "No tasks found for this student",
      });
    }

    res.status(200).json(tasks);
  } catch (error) {
    console.error("❌ Error fetching tasks for student:", error);
    res.status(500).json({ message: "Failed to fetch student tasks" });
  }
};

/* 
--------------------------------------------------
📕 UPDATE TASK STATUS
--------------------------------------------------
*/
export const updateTaskStatus = async (req, res) => {
  try {
    const { taskId, status } = req.body;

    if (!taskId || !status) {
      return res.status(400).json({ message: "Task ID and status are required." });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    task.status = status;
    if (status === "In Progress" && !task.startDate) {
      task.startDate = new Date();
    }
    if (status === "Completed") {
      task.completedDate = new Date();
    }

    await task.save();
    res.status(200).json({ message: "Task status updated successfully.", task });
  } catch (error) {
    console.error("❌ Error updating task status:", error);
    res.status(500).json({ message: "Failed to update task status" });
  }
};

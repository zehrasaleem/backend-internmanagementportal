import Task from "../models/task.model.js";
import User from "../models/User.js";

export const createTask = async (req, res) => {
  try {
    const { title, subHeading, description, assignedTo, dueDate, status, project } = req.body;

    if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
      return res.status(400).json({ message: "Please assign at least one student." });
    }

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

export const getTasks = async (req, res) => {
  try {
    const tasks = await Task.find().populate("assignedTo", "name email");
    res.status(200).json(tasks);
  } catch (error) {
    console.error("❌ Error fetching tasks:", error);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
};


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

import Task from "../models/task.model.js";

/* 
--------------------------------------------------
📘 CREATE NEW TASK
--------------------------------------------------
*/
export const createTask = async (req, res) => {
  try {
    const task = await Task.create(req.body);
    res.status(201).json({
      message: "Task created successfully",
      task,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ message: "Failed to create task" });
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
    console.error("Error fetching tasks:", error);
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

    // ✅ Fetch tasks where assignedTo matches student's ObjectId
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
    console.error("Error fetching tasks for student:", error);
    res.status(500).json({ message: "Failed to fetch student tasks" });
  }
};

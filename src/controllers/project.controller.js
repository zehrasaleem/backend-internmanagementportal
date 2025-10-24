import mongoose from "mongoose";
import Project from "../models/project.js";
import User from "../models/User.js";

// Helper: validate and trim id
const cleanId = (rawId) => {
  if (!rawId) return null;
  const id = String(rawId).trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return id;
};

// 🟢 CREATE PROJECT
export const createProject = async (req, res) => {
  try {
    const { title, description, dueDate, color, status } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Project title is required" });
    }

    const existing = await Project.findOne({ title: title.trim() });
    if (existing) {
      return res.status(409).json({ message: "A project with this title already exists" });
    }

    const project = new Project({
      title: title.trim(),
      description: description || "",
      dueDate: dueDate ? new Date(dueDate) : null,
      color: color || "#3b82f6",
      status: status || "todo",
      assignedTo: [],
      createdBy: req.user?._id || null,
    });

    const saved = await project.save();
    const populated = await Project.findById(saved._id)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email");

    res.status(201).json(populated);
  } catch (err) {
    console.error("❌ Error creating project:", err);
    res.status(500).json({ message: "Failed to create project", error: err.message });
  }
};

// 🟡 GET ALL PROJECTS
export const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({})
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json(projects);
  } catch (err) {
    console.error("❌ Error fetching projects:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🟣 GET SINGLE PROJECT
export const getProject = async (req, res) => {
  try {
    const id = cleanId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID" });

    const project = await Project.findById(id)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    res.status(200).json(project);
  } catch (err) {
    console.error("❌ Error fetching project:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🟠 UPDATE PROJECT
export const updateProject = async (req, res) => {
  try {
    const id = cleanId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID" });

    const updates = req.body;

    if (updates.title) {
      const duplicate = await Project.findOne({
        title: updates.title.trim(),
        _id: { $ne: id },
      });
      if (duplicate) {
        return res.status(409).json({ message: "A project with this title already exists" });
      }
      updates.title = updates.title.trim();
    }

    const project = await Project.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    })
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    res.status(200).json(project);
  } catch (err) {
    console.error("❌ Error updating project:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🔴 DELETE PROJECT
export const deleteProject = async (req, res) => {
  try {
    const id = cleanId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID" });

    const project = await Project.findByIdAndDelete(id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    res.status(200).json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting project:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🟤 ASSIGN / UNASSIGN INTERN
export const modifyAssignees = async (req, res) => {
  try {
    const id = cleanId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID" });

    const { userId, action } = req.body;
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const userExists = await User.exists({ _id: userId });
    if (!userExists) return res.status(404).json({ message: "User not found" });

    if (action === "assign") {
      if (!project.assignedTo.includes(userId)) project.assignedTo.push(userId);
    } else if (action === "unassign") {
      project.assignedTo = project.assignedTo.filter((id) => id.toString() !== userId);
    } else {
      return res.status(400).json({ message: "Invalid action" });
    }

    await project.save();
    const populated = await Project.findById(project._id)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email");

    res.status(200).json(populated);
  } catch (err) {
    console.error("❌ Error modifying assignees:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

import mongoose from "mongoose";
import Project from "../models/Project.js";
import User from "../models/User.js";

// Helper: validate and trim ID
const cleanId = (rawId) => {
  if (!rawId) return null;
  const id = String(rawId).trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return id;
};

// 🟢 CREATE PROJECT
export const createProject = async (req, res) => {
  try {
    const { title, description, dueDate, color, status, teamLead } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Project title is required" });
    }

    const existing = await Project.findOne({ title: title.trim() });
    if (existing) {
      return res.status(409).json({ message: "A project with this title already exists" });
    }

    // ✅ Validate teamLead if provided (ROLE CHECK ADDED)
    let leadId = null;
    if (teamLead) {
      const lead = await User.findById(teamLead);
      if (!lead) return res.status(404).json({ message: "Team lead not found" });

      if (lead.role !== "student") {
        return res.status(400).json({ message: "Only students can be assigned as Team Lead" });
      }

      leadId = teamLead;
    }

    const project = new Project({
      title: title.trim(),
      description: description || "",
      dueDate: dueDate ? new Date(dueDate) : null,
      color: color || "#3b82f6",
      status: status || "todo",
      assignedTo: [],
      teamLead: leadId,
      createdBy: req.user?._id || null, // Sets the creator!
    });

    const saved = await project.save();
    const populated = await Project.findById(saved._id)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .populate("teamLead", "name email");

    res.status(201).json(populated);
  } catch (err) {
    console.error("❌ Error creating project:", err);
    res.status(500).json({ message: "Failed to create project", error: err.message });
  }
};

// 🟡 GET ALL PROJECTS (STRICTLY FILTERED BY CREATOR)
export const getProjects = async (req, res) => {
  try {
    let query = {};

    // If the logged-in user is an admin/supervisor
    if (req.user && req.user.role !== "student") {
      // ✅ STRICT ISOLATION: Admin only sees projects they explicitly created
      query = { createdBy: req.user._id };
      
    } else if (req.user && req.user.role === "student") {
      // If a student fetches this, only show projects they are a part of
      query = {
        $or: [
          { teamLead: req.user._id },
          { assignedTo: req.user._id },
        ],
      };
    }

    const projects = await Project.find(query)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .populate("teamLead", "name email")
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
      .populate("createdBy", "name email")
      .populate("teamLead", "name email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    // Security Check
    if (req.user.role !== "student" && project.createdBy?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only view projects you created." });
    }

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

    // ✅ Security check: Verify the admin created this project before allowing updates
    const existingProject = await Project.findById(id);
    if (!existingProject) return res.status(404).json({ message: "Project not found" });

    if (req.user.role !== "student" && existingProject.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only edit projects you created." });
    }

    const updates = req.body;

    // Check for duplicate title
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

    // Validate teamLead if provided
    if (updates.teamLead) {
      const lead = await User.findById(updates.teamLead);
      if (!lead) return res.status(404).json({ message: "Team lead not found" });

      if (lead.role !== "student") {
        return res.status(400).json({ message: "Only students can be assigned as Team Lead" });
      }
    }

    const project = await Project.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    })
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .populate("teamLead", "name email");

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

    // ✅ Security check: Verify the admin created this project before allowing deletion
    const existingProject = await Project.findById(id);
    if (!existingProject) return res.status(404).json({ message: "Project not found" });

    if (req.user.role !== "student" && existingProject.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only delete projects you created." });
    }

    await Project.findByIdAndDelete(id);

    res.status(200).json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting project:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🔵 GET PROJECTS WHERE CURRENT USER IS TEAM LEAD
export const getMyLeadProjects = async (req, res) => {
  try {
    const userId = req.user._id;

    const projects = await Project.find({ teamLead: userId })
      .populate("assignedTo", "name email")
      .populate("teamLead", "name email");

    res.status(200).json(projects);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch team lead projects" });
  }
};

// 🟤 ASSIGN / UNASSIGN INTERN
export const modifyAssignees = async (req, res) => {
  try {
    const id = cleanId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid project ID" });

    const { userId, action } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    // Role check for the student being assigned
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role !== "student") {
      return res.status(400).json({ message: "Only students can be assigned to projects" });
    }

    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    // ✅ Security check: Verify admin created the project before they can assign students to it
    if (req.user.role !== "student" && project.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only manage assignees for projects you created." });
    }

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
      .populate("createdBy", "name email")
      .populate("teamLead", "name email");

    res.status(200).json(populated);
  } catch (err) {
    console.error("❌ Error modifying assignees:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
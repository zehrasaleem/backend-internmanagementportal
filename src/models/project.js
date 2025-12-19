// models/Project.js
import mongoose from "mongoose";

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    
    // Status options combined from both schemas
    status: {
      type: String,
      enum: ["todo", "inprogress", "completed", "Active", "Completed", "On Hold"],
      default: "todo",
    },

    color: { type: String, default: "#3b82f6" },

    // User who created the project
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Team lead assigned to the project
    teamLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Users assigned to the project
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Optional due date
    dueDate: { type: Date },
  },
  { timestamps: true }
);

// Fix: Check if model already exists before creating
const Project = mongoose.models.Project || mongoose.model("Project", ProjectSchema);

export default Project;

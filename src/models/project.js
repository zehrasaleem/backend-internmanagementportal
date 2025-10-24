import mongoose from "mongoose";

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dueDate: { type: Date },
    color: { type: String, default: "#3b82f6" },
    status: {
      type: String,
      enum: ["todo", "inprogress", "completed", "Active", "Completed", "On Hold"],
      default: "todo",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Project", ProjectSchema);

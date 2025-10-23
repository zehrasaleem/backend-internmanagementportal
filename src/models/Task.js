// server/models/Task.js
import mongoose from "mongoose";

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  project: String,
  subHeading: String,
  dueDate: { type: Date, required: true },
  status: { type: String, enum: ["Assigned", "In Progress", "Completed"], default: "Assigned" },
}, { timestamps: true });

export default mongoose.model("Task", taskSchema);

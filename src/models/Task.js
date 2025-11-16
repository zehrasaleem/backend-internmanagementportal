import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    // 📘 Basic Task Info
    title: { type: String, required: true },
    description: { type: String, default: "" },
    subHeading: { type: String, default: "" },

    // 👥 Multiple students can be assigned to one task
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    // 📝 Admin who assigned the task
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 📂 Optional project name or reference
    project: { type: String, default: "" },

    // 📅 Due Date & Status
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["Assigned", "In Progress", "Completed", "Pending Approval"], // added Pending Approval
      default: "Assigned",
    },

    progress: {
      type: Number,
      default: 0, // 0–100
      min: 0,
      max: 100,
    },

    // ⏱️ Time tracking fields
    startDate: { type: Date, default: null }, // when task started
    completedDate: { type: Date, default: null }, // when task completed
  },
  { timestamps: true } // adds createdAt & updatedAt automatically
);

export default mongoose.model("Task", taskSchema);

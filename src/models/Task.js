import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    subHeading: { type: String, default: "" },

    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    dueDate: { type: Date, required: true },

    status: {
      type: String,
      enum: [
        "Assigned",
        "In Progress",
        "Completed",
        "Pending Approval",
        "Pending Start Approval",
        "Pending TL Approval",
        "Pending Admin Approval",
        "Rejected",
        "Missed",
      ],
      default: "Assigned",
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
     adminApproved: { type: Boolean, default: false },

    startDate: { type: Date, default: null },
    completedDate: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);

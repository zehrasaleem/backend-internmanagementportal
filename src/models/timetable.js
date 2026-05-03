import mongoose from "mongoose";

const slotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      required: true,
    },
    time: {
      type: String,
      enum: [
        "8:30 - 9:20",
        "9:30 - 10:20",
        "10:30 - 11:20",
        "11:30 - 12:20",
        "12:30 - 1:20",
        "1:30 - 2:20",
        "2:30 - 3:20",
        "3:30 - 4:30",
      ],
      required: true,
    },

    // ✅ ALWAYS STRING YYYY-MM-DD
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    status: {
      type: String,
      enum: ["free", "busy", "task", "meeting"],
      default: "free",
    },

    label: { type: String, default: "" },

    meetingDate: { type: String, default: "" },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { _id: true }
);

slotSchema.index({ day: 1, time: 1, date: 1 });

const timetableSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    slots: [slotSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Timetable", timetableSchema); 
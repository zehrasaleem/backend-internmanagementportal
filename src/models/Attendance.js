import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    timetable: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Timetable",
      required: true,
    },

    slotId: {
      type: String,
      required: true,
    },

    dateKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    day: {
      type: String,
      required: true,
    },

    time: {
      type: String,
      required: true,
    },

    meetingTitle: {
      type: String,
      default: "Meeting",
    },

    status: {
      type: String,
      enum: ["present", "absent"],
      default: "present",
    },

    markedAt: {
      type: Date,
      default: null,
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },

    accuracy: {
      type: Number,
      default: null,
    },

    distanceMeters: {
      type: Number,
      default: null,
    },

    withinGeofence: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

attendanceSchema.index(
  { student: 1, dateKey: 1, slotId: 1 },
  { unique: true }
);

export default mongoose.model("Attendance", attendanceSchema);
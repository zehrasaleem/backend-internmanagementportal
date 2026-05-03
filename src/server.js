// ---------- Load Environment Variables FIRST ----------
import dotenv from "dotenv";
dotenv.config();

// ---------- Core Imports ----------
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";

// ---------- DB ----------
import { connectMongo } from "./db/mongo.js";

// ---------- Routes ----------
import googleAuth from "./routes/googleAuth.js";
import userRoutes from "./routes/UserRoutes.js";
import authRoutes from "./routes/auth.routes.js";
import taskRoutes from "./routes/task.routes.js";
import projectRoutes from "./routes/project.routes.js";
import timetableRoutes from "./routes/timetable.routes.js";
import adminTimetableRoutes from "./routes/admin.timetable.routes.js";
import teamLeadTimetableRoutes from "./routes/teamlead.timetable.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";



// ---------- Utils ----------
import { fixProjectIndexes } from "./utils/fixIndexes.js";

// ---------- Initialize Express ----------
const app = express();
const PORT = process.env.PORT || 5000;

// ---------- Middleware ----------
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8080",
    credentials: true,
  })
);
app.use(express.json());

// ---------- API Routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/google", googleAuth);
app.use("/api/timetable", timetableRoutes);
app.use("/api/admin/timetable", adminTimetableRoutes);
app.use("/api/teamlead/timetable", teamLeadTimetableRoutes);
app.use("/api/attendance", attendanceRoutes);


// ---------- Health Check ----------
app.get("/", (req, res) => {
  res.status(200).send("✅ Backend is running 🚀");
});

// ---------- Start Server AFTER DB Connect ----------
let server;

connectMongo()
  .then(async () => {
    console.log("✅ MongoDB connected successfully.");

    // Fix indexes if schema changed
    await fixProjectIndexes();

    server = app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });

// ---------- Graceful Shutdown ----------
const shutdown = () => {
  console.log("🛑 Shutting down server...");

  if (server) {
    server.close(() => {
      console.log("✅ HTTP server closed.");

      mongoose.connection.close(false, () => {
        console.log("✅ MongoDB connection closed.");
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import mongoose from "mongoose"; // For MongoDB connection events
import { connectMongo } from "./db/mongo.js";

// 🧩 Route Imports
import googleAuth from "./routes/googleAuth.js";
import userRoutes from "./routes/UserRoutes.js";
import authRoutes from "./routes/auth.routes.js";
import taskRoutes from "./routes/task.routes.js";
import projectRoutes from "./routes/project.routes.js"; // ✅ Project management routes

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
app.use("/api/auth", authRoutes);       // Authentication
app.use("/api/users", userRoutes);      // User management
app.use("/api/tasks", taskRoutes);      // Task management
app.use("/api/projects", projectRoutes); // ✅ Project management
app.use("/api/google", googleAuth);     // Google OAuth (optional)

// ---------- Health Check ----------
app.get("/", (req, res) => {
  res.status(200).send("✅ Backend is running 🚀");
});

// ---------- Start Server AFTER DB connects ----------
let server;

connectMongo()
  .then(async () => {
    console.log("✅ MongoDB connected successfully.");

    // ✅ Fix old indexes safely (useful if unique constraints changed)
    await fixProjectIndexes();

    if (!server) {
      server = app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
      });
    }
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

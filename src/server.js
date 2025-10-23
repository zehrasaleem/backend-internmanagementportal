import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { connectMongo } from "./db/mongo.js";
import googleAuth from "./routes/googleAuth.js";
import userRoutes from "./routes/UserRoutes.js";
import authRoutes from "./routes/auth.routes.js";
import taskRoutes from "./routes/task.routes.js"; // ✅ tasks

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

// ---------- Routes ----------
// Prefix all routes with /api to match frontend
app.use("/api/auth", authRoutes);      // login, register, OTP
app.use("/api/users", userRoutes);     // user management
app.use("/api/tasks", taskRoutes);     // task management
app.use("/api/google", googleAuth);    // Google OAuth (optional / separate)

// Test route
app.get("/", (req, res) => {
  res.status(200).send("Backend is running 🚀");
});

// ---------- Start Server AFTER DB connects ----------
let server;

connectMongo()
  .then(() => {
    if (!server) {
      server = app.listen(PORT, () => {
        console.log(`✅ Server running at http://localhost:${PORT}`);
      });
    }
  })
  .catch((err) => {
    console.error("❌ Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });

// ---------- Graceful shutdown ----------
const shutdown = () => {
  console.log("Shutting down server...");
  if (server) {
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

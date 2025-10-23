import express from "express";
import cors from "cors";
import googleAuth from "./routes/googleAuth.js";
import userRoutes from "./routes/UserRoutes.js";

const app = express();

// ✅ Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8080",
    credentials: true,
  })
);
app.use(express.json());

// ✅ Routes
app.use("/users", userRoutes);
app.use("/auth", googleAuth);

// ✅ Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

export default app;

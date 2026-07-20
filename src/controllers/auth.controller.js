import User from "../models/User.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// 🟢 REGISTER A NEW STUDENT
export const register = async (req, res) => {
  try {
    const { name, email, password, supervisorEmail, discipline, batch, rollNo } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    // 1. Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    // 2. Create the new user and attach the Supervisor Email!
    const newUser = new User({
      name,
      email,
      password, // Note: Your User model pre-save hook will hash this automatically
      role: "student",
      supervisorEmail: supervisorEmail || null, // ✅ CRITICAL: Links student to admin
      discipline: discipline || "",
      batch: batch || "",
      rollNo: rollNo || "",
      isVerified: true, 
      approvalStatus: "pending"
    });

    await newUser.save();

    // 3. Generate Token (Optional, if you want them to log in immediately)
    const token = jwt.sign(
      { id: newUser._id, role: newUser.role, email: newUser.email },
      process.env.JWT_SECRET || "your_secret_key",
      { expiresIn: "1d" }
    );

    res.status(201).json({
      success: true,
      message: "Student registered successfully",
      token,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        supervisorEmail: newUser.supervisorEmail
      }
    });
  } catch (error) {
    console.error("❌ Error in registration:", error);
    res.status(500).json({ message: "Server error during registration", error: error.message });
  }
};

// 🟡 GET ALL ADMINS (For the frontend dropdown)
export const getAdminsForSignup = async (req, res) => {
  try {
    // Fetch all users who are NOT students (e.g., admins, team leads, supervisors)
    const admins = await User.find({ role: { $ne: "student" } }).select("name email role");
    
    res.status(200).json({
      success: true,
      admins,
    });
  } catch (error) {
    console.error("❌ Error fetching admins:", error);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
};
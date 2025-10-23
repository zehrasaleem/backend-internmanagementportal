// src/models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: {
      type: String,
      required: function () { return !this.googleId; },
      select: false,
    },
    googleId: { type: String },

    role: { type: String, enum: ["student", "admin"], default: "student" },
    isVerified: { type: Boolean, default: false },

    // 🔽 add these so they’re saved in MongoDB
    discipline: { type: String },
    batch: { type: String },
    rollNo: { type: String },
    phoneNumber: { type: String },
    semester: { type: String },          // keep string for flexibility
    dateOfJoining: { type: Date },

    picture: { type: String },
    otp: { type: String },
    otpExpires: { type: Date },
  },
  { timestamps: true }
);

// hash password if set/changed
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;

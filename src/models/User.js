import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/* ------------------------- USER SCHEMA ------------------------- */
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: function () {
      // Name required only after verification or signup completion
      return this.isVerified;
    },
  },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // optional now for Google OAuth users
  googleId: { type: String }, // optional for Google OAuth
  role: { type: String, default: "student" }, // student, admin, etc.
  picture: { type: String }, // user profile picture
  isVerified: { type: Boolean, default: false },
  otp: String,
  otpExpires: Date,
  // Student-specific fields
  discipline: String,
  batch: String,
  rollNo: String,
  phoneNumber: String,
  semester: String,
  dateOfJoining: Date,
});

/* ------------------------- HASH PASSWORD ------------------------- */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

/* ------------------------- COMPARE PASSWORD ------------------------- */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

/* ------------------------- USER MODEL ------------------------- */
const User = mongoose.model("User", userSchema);

/* ------------------- GET ALL STUDENTS (FOR ADMIN) ------------------- */
export const getAllStudents = async (req, res) => {
  try {
    const students = await User.find({ role: "student" }).select(
      "name email _id discipline batch rollNo semester dateOfJoining"
    );
    res.status(200).json({
      success: true,
      students,
    });
  } catch (error) {
    console.error("❌ Error fetching students:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch students",
    });
  }
};

/* ------------------------- EXPORT ------------------------- */
export default User;

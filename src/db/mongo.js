import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "node:dns";
import path from "path";
import { fileURLToPath } from "url";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
// ✅ Ensure dotenv loads the correct .env file path manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

export async function connectMongo() {
  try {
    console.log("Loaded MONGODB_URI:", process.env.MONGODB_URI);

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined. Check your .env location.");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB (Mongoose)");
  } catch (err) {
    console.error("❌ MongoDB connection failed:");
    console.error(err);
    process.exit(1);
  }
}

// src/services/mailService.js
import nodemailer from "nodemailer";
import "dotenv/config";


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true", // true -> port 465
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendOtpEmail(to, otp) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = "Your OTP Code (valid for 10 minutes)";
  const text = `Your OTP is ${otp}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6">
      <h2>IMPCSIT Portal</h2>
      <p>Use the following code to verify your email:</p>
      <div style="font-size:24px;font-weight:700;letter-spacing:4px;margin:12px 0">${otp}</div>
      <p>This code expires in <b>10 minutes</b>.</p>
      <hr/>
      <p style="font-size:12px;color:#666">If you didn't request this, you can ignore this email.</p>
    </div>
  `;
  return transporter.sendMail({ from, to, subject, text, html });
}

// (optional) call once on startup to ensure SMTP works
export async function verifySmtp() {
  try {
    await transporter.verify();
    console.log("📨 SMTP transport ready");
  } catch (e) {
    console.error("SMTP verify failed:", e.message);
  }
}

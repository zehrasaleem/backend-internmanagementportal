// src/services/mailService.js
import "dotenv/config";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export async function sendOtpEmail(to, otp) {
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

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.SMTP_FROM_NAME || "IMPCSIT Portal",
        email: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API email failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function sendAdminSignupApprovalEmail({
  to,
  user,
  approveUrl,
  rejectUrl,
}) {
  const subject = "New Admin Signup Approval Request";
  const text = `
A new admin signup request has been submitted.

Name: ${user.name}
Email: ${user.email}

Approve: ${approveUrl}
Reject: ${rejectUrl}
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6">
      <h2>IMPCSIT Portal</h2>
      <p>A new <b>admin signup request</b> has been submitted.</p>

      <p><b>Name:</b> ${user.name}</p>
      <p><b>Email:</b> ${user.email}</p>

      <div style="margin-top:20px">
        <a href="${approveUrl}" style="background:#16a34a;color:white;padding:10px 16px;text-decoration:none;border-radius:6px;margin-right:10px">
          Approve Admin
        </a>

        <a href="${rejectUrl}" style="background:#dc2626;color:white;padding:10px 16px;text-decoration:none;border-radius:6px">
          Reject Admin
        </a>
      </div>

      <hr style="margin-top:24px"/>
      <p style="font-size:12px;color:#666">
        This approval link is for admin signup verification.
      </p>
    </div>
  `;

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.SMTP_FROM_NAME || "IMPCSIT Portal",
        email: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API email failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function verifySmtp() {
  console.log("📨 Brevo API mail service ready");
}
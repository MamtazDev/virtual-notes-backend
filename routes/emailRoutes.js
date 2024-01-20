const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.USER_NAME,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

router.post("/send-email", async (req, res) => {
  console.log("Received email data:", req.body);
  const { subject, text } = req.body;

  if (!subject || !text) {
    return res.status(400).send("Subject and text fields are required.");
  }

  const mailOptions = {
    from: process.env.USER_NAME,
    to: "support@virtunotes.com",
    subject: subject,
    text: text,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    res
      .status(200)
      .json({ message: "Message sent", messageId: info.messageId });
  } catch (error) {
    console.error("Error sending email: ", error);
    res
      .status(500)
      .json({ message: "Error sending email", error: error.message });
  }
});

module.exports = router;

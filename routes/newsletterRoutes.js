const express = require("express");
const router = express.Router();
const NewsletterSubscription = require("../models/NewsletterSubscription"); // Adjust the path as necessary

// Middleware for validating email
function validateEmail(req, res, next) {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid or missing email" });
  }

  next();
}

// POST route to subscribe to the newsletter
router.post("/subscribe-newsletter", validateEmail, async (req, res) => {
  const { email } = req.body;

  try {
    const existingSubscription = await NewsletterSubscription.findOne({
      email,
    });
    if (existingSubscription) {
      return res
        .status(409)
        .json({ message: "Email already subscribed to the newsletter." });
    }

    const newSubscription = new NewsletterSubscription({ email });
    await newSubscription.save();

    res.status(200).json({ message: "Subscribed to newsletter successfully!" });
  } catch (error) {
    console.error("Error subscribing to newsletter:", error);
    res.status(500).json({ message: "Error subscribing to newsletter" });
  }
});

module.exports = router;

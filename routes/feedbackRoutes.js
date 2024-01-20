const express = require("express");
const router = express.Router();
const Feedback = require("../models/Feedback");
const { authenticateUser } = require("../middleware/auth");

// Submit feedback
router.post("/submit-feedback", authenticateUser, async (req, res) => {
  try {
    const { tool, rating, feedback } = req.body;

    const newFeedback = new Feedback({
      tool,
      rating,
      feedback,
      submittedAt: new Date(),
    });

    await newFeedback.save();
    res.status(201).json({
      message: "Feedback submitted successfully",
      feedback: newFeedback,
    });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res
      .status(500)
      .json({ message: "Failed to submit feedback", error: error.message });
  }
});

// Retrieve all feedback (for admin purposes, potentially)
router.get("/", authenticateUser, async (req, res) => {
  try {
    // Add logic here to ensure only admins can retrieve all feedback
    const feedbackList = await Feedback.find({});
    res.status(200).json(feedbackList);
  } catch (error) {
    console.error("Error retrieving feedback:", error);
    res
      .status(500)
      .json({ message: "Failed to retrieve feedback", error: error.message });
  }
});

// Export the router
module.exports = router;

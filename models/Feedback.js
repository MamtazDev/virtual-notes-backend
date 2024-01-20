const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema({
  tool: String,
  rating: Number,
  feedback: String,
  submittedAt: { type: Date, default: Date.now },
});

// Export the Feedback model
module.exports = mongoose.model("Feedback", feedbackSchema);

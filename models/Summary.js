const mongoose = require("mongoose");

const summarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  topic: String,
  points: [String],
  date: { type: Date, default: Date.now },
});

// Export the Summary model
module.exports = mongoose.model("Summary", summarySchema);

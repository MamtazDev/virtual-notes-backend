const mongoose = require("mongoose");

const audioSchema = new mongoose.Schema({
  gcsUri: String,
  contentType: String,
});

// Export the Audio model
module.exports = mongoose.model("Audio", audioSchema);

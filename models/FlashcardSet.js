const mongoose = require("mongoose");

const flashcardSetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  title: String,
  description: String,
  flashcards: [
    {
      term: String,
      definition: String,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

// Export the FlashcardSet model
module.exports = mongoose.model("FlashcardSet", flashcardSetSchema);

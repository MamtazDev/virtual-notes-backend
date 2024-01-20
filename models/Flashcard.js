const mongoose = require("mongoose");

const flashcardSchema = new mongoose.Schema({
  term: String,
  definition: String,
  setId: { type: mongoose.Schema.Types.ObjectId, ref: "FlashcardSet" },
});

// Export the Flashcard model
module.exports = mongoose.model("Flashcard", flashcardSchema);

const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const mongoose = require("mongoose");
const { ObjectId } = require("mongoose").mongo;
const textract = require("textract");
const FlashcardSet = require("../models/FlashcardSet");
const Flashcard = require("../models/Flashcard");
const { authenticateUser } = require("../middleware/auth");

// Define the storage and file size limit for uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Example: 5MB limit
});

// Google API
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Extract text
const extractTextFromFiles = async (files) => {
  const textPromises = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        textract.fromBufferWithName(
          file.originalname,
          file.buffer,
          (err, text) => {
            if (err) reject(err);
            else resolve(text);
          }
        );
      })
  );

  return Promise.all(textPromises).then((texts) => texts.join(" "));
};

// Create a new flashcard set
router.post("/save-flashcards", authenticateUser, async (req, res) => {
  try {
    const { title, description, flashcards } = req.body;
    const userId = req.user.id;

    if (!title || !flashcards) {
      return res
        .status(400)
        .json({ message: "Title and flashcards are required." });
    }

    const newFlashcardSet = new FlashcardSet({
      userId,
      title,
      description,
      flashcards,
    });

    await newFlashcardSet.save();

    res.status(201).json({
      message: "Flashcard set saved successfully",
      setId: newFlashcardSet._id, // The ID of the new flashcard set
      flashcards: newFlashcardSet.flashcards, // The flashcards of the new set
    });
  } catch (error) {
    console.error("Error saving flashcard set:", error);
    res.status(500).json({ message: "Error saving flashcard set" });
  }
});

// Get all flashcard sets for a user
router.get("/flashcard-sets", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const flashcardSets = await FlashcardSet.find({ userId }).exec();

    res.status(200).json({ flashcardSets });
  } catch (error) {
    console.error("Error fetching flashcard sets:", error);
    res.status(500).json({ message: "Error fetching flashcard sets" });
  }
});

// Get a single flashcard set
router.get("/sets/:setId", authenticateUser, async (req, res) => {
  const { setId } = req.params;
  try {
    const flashcardSet = await FlashcardSet.findById(setId);
    if (!flashcardSet) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.status(200).json(flashcardSet);
  } catch (error) {
    console.error("Error retrieving flashcard set:", error);
    res.status(500).json({
      message: "Failed to retrieve flashcard set",
      error: error.message,
    });
  }
});

// Update a flashcard set
router.put("/sets/:setId", authenticateUser, async (req, res) => {
  const { setId } = req.params;
  const { title, description, flashcards } = req.body;
  try {
    const flashcardSet = await FlashcardSet.findByIdAndUpdate(
      setId,
      {
        title,
        description,
        flashcards,
      },
      { new: true }
    );

    if (!flashcardSet) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.status(200).json(flashcardSet);
  } catch (error) {
    console.error("Error updating flashcard set:", error);
    res.status(500).json({
      message: "Failed to update flashcard set",
      error: error.message,
    });
  }
});

// Update flashcard set
router.put("/flashcard-sets/:setId", authenticateUser, async (req, res) => {
  const { setId } = req.params;
  const { flashcards } = req.body; // This would be an array of flashcards

  try {
    // Find the flashcard set and update it with the new array of flashcards
    const flashcardSet = await FlashcardSet.findByIdAndUpdate(
      setId,
      {
        flashcards: flashcards,
      },
      { new: true }
    );

    if (!flashcardSet) {
      return res.status(404).json({ message: "Flashcard set not found" });
    }
    res.status(200).json(flashcardSet);
  } catch (error) {
    console.error("Error updating flashcard set:", error);
    res.status(500).json({
      message: "Failed to update flashcard set",
      error: error.message,
    });
  }
});

// Delete a flashcard set
router.delete("/flashcard-sets/:setId", authenticateUser, async (req, res) => {
  try {
    const { setId } = req.params;
    const userId = req.user.id;

    const flashcardSet = await FlashcardSet.findOne({ _id: setId, userId });
    if (!flashcardSet) {
      return res.status(404).json({
        message: "Flashcard set not found or does not belong to the user",
      });
    }
    console.log("flashcardSet", flashcardSet);

    await FlashcardSet.findByIdAndDelete(setId);

    res.status(200).json({ message: "Flashcard set deleted successfully" });
  } catch (error) {
    console.error("Error deleting flashcard set:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add a flashcard to a set
router.post(
  "/flashcard-sets/:setId/flashcards",
  authenticateUser,
  async (req, res) => {
    try {
      const { setId } = req.params;
      const userId = req.user.id;
      const { term, definition } = req.body;

      const flashcardSet = await FlashcardSet.findOne({ _id: setId, userId });
      if (!flashcardSet) {
        return res.status(404).json({
          message: "Flashcard set not found or does not belong to the user",
        });
      }

      const newFlashcard = new Flashcard({
        term,
        definition,
        flashcardSetId: setId,
      });
      await newFlashcard.save();

      const updatedFlashcardSet = await FlashcardSet.findById(setId).populate(
        "flashcards"
      );

      const flashcards = await generateFlashcardsFromText(textToProcess);

      if (!flashcards || flashcards.length === 0) {
        throw new Error(
          "No flashcards were generated from the provided material."
        );
      }

      res.status(201).json({ flashcards: updatedFlashcardSet.flashcards });
    } catch (error) {
      console.error("Error in flashcard generation process:", error);
      res.status(500).json({ message: error.message, details: error });
    }
  }
);

// Delete a flashcard from a set
router.delete(
  "/flashcard-sets/:setId/flashcards/:flashcardId",
  authenticateUser,
  async (req, res) => {
    try {
      const { setId, flashcardId } = req.params;
      const userId = req.user.id;

      if (!ObjectId.isValid(flashcardId)) {
        return res.status(400).json({ message: "Invalid flashcardId" });
      }

      const flashcardSet = await FlashcardSet.findOne({ _id: setId, userId });
      if (!flashcardSet) {
        return res.status(404).json({
          message: "Flashcard set not found or does not belong to the user",
        });
      }

      await Flashcard.findOneAndDelete({
        _id: flashcardId,
        flashcardSetId: setId,
      });

      const updatedFlashcardSet = await FlashcardSet.findById(setId).populate(
        "flashcards"
      );
      res.status(200).json({ flashcards: updatedFlashcardSet.flashcards });
    } catch (error) {
      console.error("Error deleting flashcard:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Update a single flashcard
router.put(
  "/flashcard-sets/:setId/flashcards/:flashcardId",
  authenticateUser,
  async (req, res) => {
    const { setId, flashcardId } = req.params;
    const { term, definition } = req.body;

    try {
      // Find the parent flashcard set
      const flashcardSet = await FlashcardSet.findById(setId);
      if (!flashcardSet) {
        return res.status(404).json({ message: "Flashcard set not found" });
      }

      // Find the flashcard within the set
      const flashcard = flashcardSet.flashcards.id(flashcardId);
      if (!flashcard) {
        return res.status(404).json({ message: "Flashcard not found" });
      }

      // Update the flashcard fields
      flashcard.term = term;
      flashcard.definition = definition;

      // Save the flashcard set with the updated flashcard
      await flashcardSet.save();

      res.json({ message: "Flashcard updated", flashcard });
    } catch (error) {
      console.error("Error updating flashcard:", error);
      res
        .status(500)
        .json({ message: "Internal server error", error: error.toString() });
    }
  }
);

// Generate Flashcards
router.post(
  "/generate-flashcards",
  authenticateUser,
  upload.single("materialFile"),
  async (req, res) => {
    try {
      let textToProcess = "";
      if (req.file) {
        const extractedText = await extractTextFromFiles([req.file]);
        textToProcess = extractedText;
      } else if (req.body.materialText) {
        textToProcess = req.body.materialText;
      }

      if (!textToProcess || textToProcess.trim() === "") {
        throw new Error("No text was provided for flashcard generation.");
      }

      const flashcards = await generateFlashcardsFromText(textToProcess);

      if (!flashcards || flashcards.length === 0) {
        throw new Error(
          "No flashcards were generated from the provided material."
        );
      }

      res.json({ flashcards });
    } catch (error) {
      console.error("Error in flashcard generation process:", error);
      res.status(500).json({ message: error.message, details: error });
    }
  }
);

async function generateFlashcardsFromText(text) {
  const maxCharactersPerSegment = 4000;
  const segments = splitTextIntoSegments(text, maxCharactersPerSegment);
  let allFlashcards = [];

  for (const segment of segments) {
    try {
      const segmentFlashcards = await processSegment(segment);
      allFlashcards = allFlashcards.concat(segmentFlashcards);
    } catch (error) {
      console.error(`Error processing segment: ${error}`);
      // Handle segment processing error
    }
  }

  return allFlashcards;
}

function splitTextIntoSegments(text, maxChars) {
  let segments = [];
  while (text.length > 0) {
    let segment = text.substring(0, maxChars);
    let nextIndex = maxChars;
    // Optional: split at the end of a sentence
    if (text.length > maxChars) {
      let lastPeriod = segment.lastIndexOf(".");
      if (lastPeriod > -1) {
        segment = segment.substring(0, lastPeriod + 1);
        nextIndex = lastPeriod + 1;
      }
    }
    segments.push(segment);
    text = text.substring(nextIndex);
  }
  return segments;
}

async function processSegment(segment) {
  const prompt = `
  Analyze the following educational text to identify key concepts and their explanations. For each important term, create a flashcard with the format:
  
  Term: [Key Term]
  Definition: [Explanation of the Key Term]
  
  Text:
  ${segment}
  `;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();

    console.log("Gemini API Response for segment:", text);

    const segmentFlashcards = parseFlashcards(text);
    return segmentFlashcards;
  } catch (error) {
    console.error("Error generating flashcards for segment:", error);
    throw error; // Re-throw the error for caller to handle
  }
}

// Parse Flashcards
function parseFlashcards(text) {
  const entries = text.trim().split("\n\n");
  const flashcards = [];

  entries.forEach((entry) => {
    const lines = entry.split("\n").map((line) => line.trim());
    const termLine = lines.find((line) => line.startsWith("Term:"));
    const definitionLine = lines.find((line) => line.startsWith("Definition:"));

    if (termLine && definitionLine) {
      const term = termLine.substring("Term:".length).trim();
      const definition = definitionLine.substring("Definition:".length).trim();

      flashcards.push({ term, definition });
    }
  });

  console.log("Parsed Flashcards:", flashcards);
  return flashcards;
}

// Export the router
module.exports = router;

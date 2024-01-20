const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticateUser } = require("../middleware/auth");
const Quiz = require("../models/Quiz");
const textract = require("textract");

// Google API
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Multer setup for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limiting file size (example: 5MB)
});

const MIN_TEXT_LENGTH = 100;

// Submit quiz answers
router.post("/submit", authenticateUser, async (req, res) => {
  try {
    const { quizId, answers } = req.body; // quizId identifies the quiz, answers is an array of user answers

    // Validate answers and calculate score
    const result = await validateQuizAnswers(quizId, answers);

    res.status(200).json({ result });
  } catch (error) {
    console.error("Error submitting quiz:", error);
    res
      .status(500)
      .json({ message: "Failed to submit quiz", error: error.message });
  }
});

// Retrieve quiz results
router.get("/results/:quizId", authenticateUser, async (req, res) => {
  const { quizId } = req.params;
  try {
    // Assuming you store quiz results, retrieve them here
    const results = await Quiz.findById(quizId).select("results");

    res.status(200).json({ results });
  } catch (error) {
    console.error("Error retrieving quiz results:", error);
    res.status(500).json({
      message: "Failed to retrieve quiz results",
      error: error.message,
    });
  }
});

// Extract from files

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

const generateQuizQuestions = async (
  combinedText,
  difficulty,
  questionCount
) => {
  const allQuestions = [];

  for (let i = 0; i < questionCount; i++) {
    const prompt = `
      Based on the following content, create a '${difficulty}' level quiz question with four multiple-choice options labeled A, B, C, and D, and indicate the correct answer.
      Content: "${combinedText}"
    `;

    try {
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsedQuestion = parseQuizQuestion(text);

      if (!parsedQuestion) {
        console.error(
          `Could not parse quiz question. Received text: "${text}"`
        );
        continue;
      }

      allQuestions.push(parsedQuestion);
    } catch (error) {
      console.error("Error generating quiz question:", error);
      throw error;
    }
  }

  return allQuestions;
};

const parseQuizQuestion = (text) => {
  try {
    // Remove HTML tags and markdown formatting
    const cleanText = text.replace(/<\/?[^>]+>|(\*\*|\*|_)/g, "").trim();

    // Normalize spaces and handle different line breaks
    const uniformText = cleanText
      .replace(/\r?\n|\r/g, " ")
      .replace(/\s+/g, " ");

    // Regex pattern to extract the question, options, and the correct answer
    const pattern =
      /Question:\s*(.+?)\s*A\.\s*(.+?)\s*B\.\s*(.+?)\s*C\.\s*(.+?)\s*D\.\s*(.+?)\s*(Answer|Correct Answer):\s*([ABCD])\.\s*(.+)/;
    const matches = uniformText.match(pattern);

    if (matches) {
      const [
        ,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        ,
        correctOptionLetter,
      ] = matches;
      const options = [
        optionA.trim(),
        optionB.trim(),
        optionC.trim(),
        optionD.trim(),
      ];
      const correctAnswerIndex = ["A", "B", "C", "D"].indexOf(
        correctOptionLetter
      );
      const correctAnswerText = options[correctAnswerIndex];

      return {
        question: question.trim(),
        options,
        correctAnswer: correctAnswerText,
      };
    } else {
      console.error(
        "Failed to parse the quiz question with regex:",
        uniformText
      );
      return null;
    }
  } catch (error) {
    console.error("Exception caught during quiz question parsing:", error);
    return null;
  }
};

// Generate quiz questions
router.post(
  "/generate-quiz",
  authenticateUser,
  upload.array("files"),
  async (req, res) => {
    try {
      const combinedText = await extractTextFromFiles(req.files);
      if (combinedText.length < MIN_TEXT_LENGTH) {
        return res
          .status(400)
          .json({ error: "Content is not detailed enough." });
      }

      const questionCount = parseInt(req.body.questionCount, 10) || 10;
      const difficulty = req.body.difficulty || "medium";
      const quizQuestions = await generateQuizQuestions(
        combinedText,
        difficulty,
        questionCount
      );

      const failedQuestions = quizQuestions
        .map((question, index) => {
          if (question === null) {
            console.log(
              `Failed to parse question at index ${index}:`,
              combinedText
            );
            return combinedText;
          }
          return null;
        })
        .filter((q) => q != null);

      // Respond with the parsed questions and any errors
      res.json({
        questions: quizQuestions.filter((q) => q != null),
        failedQuestions,
      });
    } catch (error) {
      console.error("Error in generate-quiz:", error);
      res
        .status(500)
        .json({ error: error.message || "Server error occurred." });
    }
  }
);

// Export the router
module.exports = router;

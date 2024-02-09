const express = require("express");
const router = express.Router();
const multer = require("multer");
const { authenticateUser } = require("../middleware/auth");
const Quiz = require("../models/Quiz");
const textract = require("textract");

// OpenAI API
const { OpenAI } = require("openai");
const openai = new OpenAI(process.env.OPENAI_API_KEY);

// Google API
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Multer setup for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const MIN_TEXT_LENGTH = 100;

// Submit quiz answers
router.post("/submit", authenticateUser, async (req, res) => {
  try {
    const { quizId, answers } = req.body;

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
    const promptText = `
      Based on the following content, create a '${difficulty}' level quiz question with four multiple-choice options labeled A, B, C, and D, and indicate the correct answer.
      Content: "${combinedText}"
    `;

    try {
      const completion = await openai.completions.create({
        model: "gpt-3.5-turbo-instruct",
        prompt: promptText,
        max_tokens: 1500,
        temperature: 0.5,
      });

      const text = completion.choices[0].text.trim();
      console.log("Generated Quiz Question:", text);

      const parsedQuestion = parseQuizQuestion(text);

      if (parsedQuestion) {
        allQuestions.push(parsedQuestion);
      } else {
        console.error(`Unable to parse generated question: "${text}"`);
        continue;
      }
    } catch (error) {
      console.error("Error generating quiz question with OpenAI:", error);
      throw error;
    }
  }

  return allQuestions;
};

const parseQuizQuestion = (text) => {
  try {
    const cleanText = text.replace(/<\/?[^>]+>|(\*\*|\*|_)/g, "").trim();

    const uniformText = cleanText
      .replace(/\r?\n|\r/g, " ")
      .replace(/\s+/g, " ");

    const pattern =
      /Question:\s*(.+?)\s*A\.\s*(.+?)\s*B\.\s*(.+?)\s*C\.\s*(.+?)\s*D\.\s*(.+?)\s*(Answer|Correct Answer):\s*([ABCD])\.\s*(.+)/i;

    const matches = uniformText.match(pattern);

    console.log("matches", matches);

    if (uniformText) {
      const [
        question,
        optionA,
        optionB,
        optionC,
        optionD,
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

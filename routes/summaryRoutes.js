const express = require("express");
const router = express.Router();
const multer = require("multer");
const uuid = require("uuid");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");
const { exec } = require("child_process"); // Import exec
const { Storage } = require("@google-cloud/storage"); // Import Google Cloud Storage
const speech = require("@google-cloud/speech"); // Import Google Cloud Speech-to-Text
const Summary = require("../models/Summary");
const User = require("../models/User"); // Assuming you have a User model
const Audio = require("../models/Audio"); // Assuming you have an Audio model
const { authenticateUser } = require("../middleware/auth");

const MAX_TOKENS = 1000;

module.exports = (app) => {
  const router = express.Router();

  // OpenAI API
const { OpenAI } = require("openai");
const openai = new OpenAI(process.env.OPENAI_API_KEY);

  // Google API
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  // Speech
  const speechClient = new speech.SpeechClient();
  const gcs = new Storage();

  // WebSocket Server Setup
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  function sendFeedbackToClient(message) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.on("close", () => console.log("Client disconnected"));
  });

  // Multer setup for handling file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // Compute audio duration
  let decode;
  import("audio-decode").then((module) => {
    decode = module.default;
  });

  const audioBufferUtils = require("audio-buffer-utils");

  async function computeAudioDuration(buffer) {
    try {
      const audioBuffer = await decode(buffer);
      return audioBuffer.duration;
    } catch (error) {
      console.error("Error decoding audio buffer:", error);
      throw new Error("Failed to compute audio duration.");
    }
  }

  // Split into chunks
  function splitIntoChunks(transcription, maxTokens) {
    const words = transcription.split(" ");

    const chunks = [];

    let chunk = [];
    let tokenCount = 0;

    for (let word of words) {
      if (tokenCount + word.length + 1 > maxTokens) {
        chunks.push(chunk.join(" "));

        chunk = [word];
        tokenCount = word.length + 1;
      } else {
        chunk.push(word);
        tokenCount += word.length + 1;
      }
    }

    if (chunk.length > 0) {
      chunks.push(chunk.join(" "));
    }

    return chunks;
  }

  // Download from GCS
  async function downloadFromGCS(gcsUri) {
    const [bucketName, ...filePathParts] = gcsUri
      .replace("gs://", "")
      .split("/");
    const filePath = filePathParts.join("/");

    const bucket = gcs.bucket(bucketName);
    const file = bucket.file(filePath);

    return new Promise((resolve, reject) => {
      let buffer = [];
      file
        .createReadStream()
        .on("data", (chunk) => buffer.push(chunk))
        .on("end", () => {
          if (buffer.length > 0) {
            resolve(Buffer.concat(buffer));
          } else {
            reject(new Error("Downloaded buffer is empty."));
          }
        })
        .on("error", (err) => reject(err));
    });
  }

  // Check if file exists
  async function checkFileExists(gcsUri, maxRetries = 5, delay = 2000) {
    const bucket = gcs.bucket("edu-echo-gs");
    const filePath = gcsUri.replace("gs://edu-echo-gs/", "");
    const file = bucket.file(filePath);

    for (let i = 0; i < maxRetries; i++) {
      const [exists] = await file.exists();
      if (exists) return true;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return false;
  }

  // Upload to Google Cloud Storage
  async function uploadToGCS(buffer, gcsFileName) {
    const bucketName = process.env.GCS_BUCKET_NAME;
    const bucket = gcs.bucket(bucketName);
    const file = bucket.file(gcsFileName);

    const stream = file.createWriteStream({
      metadata: {
        contentType: "audio/wav",
      },
    });

    stream.write(buffer);
    stream.end();

    return new Promise((resolve, reject) => {
      stream.on("error", (err) => {
        reject(err);
      });
      stream.on("finish", () => {
        resolve(`gs://${bucketName}/${gcsFileName}`);
      });
    });
  }

  // Convert Webm To Wav
  function convertWebmToWav(inputBuffer) {
    return new Promise((resolve, reject) => {
      const uniqueId = uuid.v4();
      const inputAudioPath = path.join(os.tmpdir(), `${uniqueId}.webm`);
      const outputAudioPath = path.join(os.tmpdir(), `${uniqueId}.wav`);

      fs.writeFileSync(inputAudioPath, inputBuffer);

      const command = `ffmpeg -i ${inputAudioPath} ${outputAudioPath}`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("FFmpeg error:", stderr);
          reject(error);
          return;
        }

        if (!fs.existsSync(outputAudioPath)) {
          reject(new Error("FFmpeg failed to convert audio"));
          return;
        }

        const outputBuffer = fs.readFileSync(outputAudioPath);
        fs.unlinkSync(inputAudioPath);
        fs.unlinkSync(outputAudioPath);

        resolve(outputBuffer);
      });
    });
  }

  // Generate Sumamry
  async function sendTranscriptionToOpenAIAPI(transcription, audioDuration) {
    if (
      !transcription ||
      transcription.toLowerCase().includes("unintelligible") ||
      transcription.trim().length === 0
    ) {
      throw new Error(
        "Transcription is empty or not understandable. No summary generated."
      );
    }

    let chunks = splitIntoChunks(transcription, MAX_TOKENS);
    let summaries = [];

    for (let chunk of chunks) {
      let promptText = `Given a class lecture transcription, summarize the key content. The transcription is: "${chunk}".\n\n`;

      promptText += `Here's what I need:\n`;
      promptText += `- A short and clear topic title.\n`;
      promptText += `- The most important points discussed, formatted as 'Title: Explanation'. Each point should start with a dash and be on a new line.\n`;
      promptText += `- A coherent summary that ties together the main points, placed under the heading 'Summary:'.\n\n`;

      promptText += `The summary should be clear, concise, and reflect only the content covered in the lecture.\n`;

      try {
        const completion = await openai.completions.create({
          model: "gpt-3.5-turbo-instruct",
          prompt: promptText,
          max_tokens: 1000,
          temperature: 0.3,
        });

        const text = completion.choices[0].text.trim();

        console.log("OpenAI GPT-3.5-turbo Response for segment:", text);

        let processedText = processAIText(text);
        summaries.push(processedText);
      } catch (error) {
        console.error(
          "Error generating summary for segment with OpenAI:",
          error
        );
        throw error;
      }
    }

    return summaries.join("\n\n-----------\n\n");
  }

  function processAIText(text) {
    let sections = text.split("\n\n");
    let topicHeading = "";
    let keyPointsSection = [];
    let detailedSummary = "";

    sections.forEach((section) => {
      if (section.startsWith("**Key Points:**")) {
        // Skip this section as we don't want to include it
      } else if (section.startsWith("**Title:**")) {
        // Combine title and explanation in one line
        const title = section.replace("**Title:**", "").trim();
        keyPointsSection.push(title);
      } else if (section.startsWith("**Explanation:**")) {
        const explanation = section.replace("**Explanation:**", "").trim();
        keyPointsSection[keyPointsSection.length - 1] += `: ${explanation}`;
      } else if (section.startsWith("**Summary:**")) {
        // Set the summary text, ensuring we remove the '**Summary:**' label
        detailedSummary = section.replace("**Summary:**", "").trim();
      } else if (!topicHeading && section.trim()) {
        // Extract the topic heading, stripping any unwanted prefixes
        topicHeading = section
          .replace(/^(Topic Title:|Primary Topic:|Topic Heading:)\s*/, "")
          .trim();
      }
    });

    let keyPointsString = keyPointsSection.join("\n\n");
    // Ensure we have a non-empty summary before adding it to the full summary
    let fullSummary = `${topicHeading}\n\n${keyPointsString}`;
    if (detailedSummary.length > 0) {
      fullSummary += `\n\n${detailedSummary}`;
    }

    return fullSummary;
  }

  // Upload
  router.post(
    "/upload-audio",
    upload.single("audio"),
    async (req, res, next) => {
      try {
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: "Audio file is required" });
        }

        const audioBuffer = req.file.buffer;
        const wavBuffer = await convertWebmToWav(audioBuffer);

        const rawUUID = uuid.v4().replace(/-/g, "");
        const gcsFileName = `audio-${rawUUID}.wav`;

        const gcsUri = await uploadToGCS(wavBuffer, gcsFileName);

        console.log(`File uploaded to: ${gcsUri}`);

        const savedAudio = new Audio({
          gcsUri: gcsUri,
          contentType: "audio/wav",
        });
        await savedAudio.save();

        sendFeedbackToClient(
          "Audio uploaded successfully and saved to database."
        );
        res.status(200).json({ audioID: rawUUID });
      } catch (error) {
        next(error);
      }
    }
  );

  // Transcription
  router.post("/transcribe-audio", async (req, res) => {
    try {
      const { audioID, userId } = req.body;
      console.log("audioID received:", audioID);

      const cleanedAudioID = audioID.replace(/-/g, "");
      const gcsUri = `gs://edu-echo-gs/audio-${cleanedAudioID}.wav`;

      const fileExists = await checkFileExists(gcsUri);
      if (!fileExists) {
        throw new Error(
          `File ${gcsUri} does not exist in GCS after multiple checks.`
        );
      }

      const wavAudioBuffer = await downloadFromGCS(gcsUri);
      if (!wavAudioBuffer || wavAudioBuffer.length === 0) {
        throw new Error("Downloaded audio buffer is empty or invalid.");
      }

      console.log(wavAudioBuffer.length, "bytes in wavAudioBuffer");

      const audioDuration = await computeAudioDuration(wavAudioBuffer);
      const MAX_ALLOWED_DURATION = 7200;

      if (audioDuration > MAX_ALLOWED_DURATION) {
        throw new Error("Audio is too long to be processed.");
      }

      const config = {
        encoding: "LINEAR16",
        sampleRateHertz: 48000,
        languageCode: "en-US",
      };
      const request = {
        audio: { uri: gcsUri },
        config: config,
      };

      const [operation] = await speechClient.longRunningRecognize(request);
      const [response] = await operation.promise();

      const combinedTranscription = response.results
        .map((result) => result?.alternatives[0]?.transcript || null)
        .filter(Boolean)
        .join("\n");

      const summary = await sendTranscriptionToOpenAIAPI(
        combinedTranscription,
        audioDuration
      );

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user.savedSummaries.push({
        topic: "Generated Topic",
        points: summary,
        date: new Date(),
      });
      await user.save();

      sendFeedbackToClient("Transcription and summarization successful.");
      res.json({
        message: "Transcription and summarization successful",
        summary: summary,
      });
    } catch (error) {
      console.error("Error:", error.message, error.stack);
      sendFeedbackToClient("Error during transcription process.");
      res
        .status(500)
        .json({ error: error.message || "Error processing audio" });
    }
  });

  // Create a new summary
  router.post("/save-summary", authenticateUser, async (req, res) => {
    const { topic, points } = req.body;

    const newSummary = new Summary({
      userId: req.user.id,
      topic,
      points,
      date: new Date(),
    });

    try {
      await newSummary.save();
      res.status(201).json({
        message: "Summary saved successfully",
        savedSummary: newSummary,
      });
    } catch (error) {
      console.error("Error saving summary:", error);
      res.status(500).json({ error: "Error saving summary" });
    }
  });

  // Get all summaries for a user
  router.get("/saved-summaries", authenticateUser, async (req, res) => {
    try {
      const summaries = await Summary.find({ userId: req.user.id });
      res.status(200).json({ summaries: summaries });
    } catch (error) {
      console.error("Error retrieving summaries:", error);
      res.status(500).json({
        message: "Failed to retrieve summaries",
        error: error.message,
      });
    }
  });

  // Get a single summary by id
  router.get("/:summaryId", authenticateUser, async (req, res) => {
    const { summaryId } = req.params;
    try {
      const summary = await Summary.findById(summaryId);
      if (!summary) {
        return res.status(404).json({ message: "Summary not found" });
      }
      res.status(200).json(summary);
    } catch (error) {
      console.error("Error retrieving summary:", error);
      res
        .status(500)
        .json({ message: "Failed to retrieve summary", error: error.message });
    }
  });

  // Update a summary
  router.put("/summaries/:summaryId", authenticateUser, async (req, res) => {
    const { summaryId } = req.params;
    const { topic, points } = req.body;
    try {
      const summary = await Summary.findByIdAndUpdate(
        summaryId,
        {
          topic,
          points,
        },
        { new: true }
      ); // Return the updated document

      if (!summary) {
        return res.status(404).json({ message: "Summary not found" });
      }
      res
        .status(200)
        .json({ message: "Summary updated successfully", summary });
    } catch (error) {
      console.error("Error updating summary:", error);
      res
        .status(500)
        .json({ message: "Failed to update summary", error: error.message });
    }
  });

  // Delete a summary
  router.delete("/summaries/:summaryId", authenticateUser, async (req, res) => {
    try {
      const { summaryId } = req.params;
      const deletedSummary = await Summary.findOneAndDelete({
        _id: summaryId,
        userId: req.user.id,
      });

      if (!deletedSummary) {
        return res.status(404).json({
          message: "Summary not found or does not belong to the user",
        });
      }

      res.status(200).json({ message: "Summary deleted successfully" });
    } catch (error) {
      console.error("Error deleting summary:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/generate-summary", async (req, res) => {
    try {
      const { transcription, audioDuration } = req.body;
      const summary = await sendTranscriptionToOpenAIAPI(
        transcription,
        audioDuration
      );
      res.json({ summary });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  function splitIntoChunks(transcription, maxTokens) {
    const words = transcription.split(" ");

    const chunks = [];

    let chunk = [];
    let tokenCount = 0;

    for (let word of words) {
      if (tokenCount + word.length + 1 > maxTokens) {
        chunks.push(chunk.join(" "));

        chunk = [word];
        tokenCount = word.length + 1;
      } else {
        chunk.push(word);
        tokenCount += word.length + 1;
      }
    }

    if (chunk.length > 0) {
      chunks.push(chunk.join(" "));
    }

    return chunks;
  }

  // Export the router

  return router;
};

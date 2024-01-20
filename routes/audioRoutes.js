const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const Audio = require("../models/Audio");

// Multer setup for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limiting file size (example: 5MB)
});

// Upload audio
router.post(
  "/upload",
  authenticateUser,
  upload.single("audio"),
  async (req, res) => {
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
router.get("/transcribe-audio", authenticateUser, async (req, res) => {
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

    const summary = await sendTranscriptionToOpenAI(
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
    res.status(500).json({ error: error.message || "Error processing audio" });
  }
});

// Get audio file
router.get("/:audioId", authenticateUser, async (req, res) => {
  const { audioId } = req.params;
  try {
    const audio = await Audio.findById(audioId);
    if (!audio) {
      return res.status(404).json({ message: "Audio not found" });
    }

    // Send the audio file or its URL
    res.status(200).json(audio);
  } catch (error) {
    console.error("Error retrieving audio:", error);
    res
      .status(500)
      .json({ message: "Failed to retrieve audio", error: error.message });
  }
});

// Delete audio file
router.delete("/:audioId", authenticateUser, async (req, res) => {
  const { audioId } = req.params;
  try {
    const audio = await Audio.findByIdAndDelete(audioId);
    if (!audio) {
      return res.status(404).json({ message: "Audio not found" });
    }

    // Additional logic to delete the file from storage if necessary

    res.status(200).json({ message: "Audio deleted successfully" });
  } catch (error) {
    console.error("Error deleting audio:", error);
    res
      .status(500)
      .json({ message: "Failed to delete audio", error: error.message });
  }
});

// Export the router
module.exports = router;

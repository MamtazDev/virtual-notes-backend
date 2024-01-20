const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { Storage } = require("@google-cloud/storage");
const uuid = require("uuid");

const gcs = new Storage();

/**
 * Uploads a buffer to Google Cloud Storage and returns the public URL.
 * @param {Buffer} buffer - The buffer to be uploaded.
 * @param {string} gcsFileName - The name of the file in Google Cloud Storage.
 * @returns {Promise<string>} - A promise that resolves with the public URL of the uploaded file.
 */
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

/**
 * Converts a WebM audio file to a WAV file using FFmpeg.
 * @param {Buffer} inputBuffer - The input audio file buffer.
 * @returns {Promise<Buffer>} - A promise that resolves with the converted audio file buffer.
 */
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

async function downloadFromGCS(gcsUri) {
  const [bucketName, ...filePathParts] = gcsUri.replace("gs://", "").split("/");
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

module.exports = {
  uploadToGCS,
  convertWebmToWav,
  checkFileExists,
  computeAudioDuration,
};

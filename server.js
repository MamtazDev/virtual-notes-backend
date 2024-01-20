// Core Modules
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const cron = require("node-cron");
const mongoose = require("mongoose");

// Environment
require("dotenv").config();

// Configurations
const connectDB = require("./config/db");
connectDB();

// Express Application Setup
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS Middleware
const corsOptions = {
  origin: "http://localhost:3000",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};
app.use(cors(corsOptions));

// Models
const User = require("./models/User");
const Audio = require("./models/Audio");
const FlashcardSet = require("./models/FlashcardSet");
const Summary = require("./models/Summary");
const Feedback = require("./models/Feedback");
const Flashcard = require("./models/Flashcard");
const Quiz = require("./models/Quiz");
const NewsletterSubscription = require("./models/NewsletterSubscription");

// Middleware
const { authenticateUser } = require("./middleware/auth");

// Routes
const userRoutes = require("./routes/userRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const flashcardRoutes = require("./routes/flashcardRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const summaryRoutes = require("./routes/summaryRoutes")(app);
const quizRoutes = require("./routes/quizRoutes");
const audioRoutes = require("./routes/audioRoutes");
const emailRoutes = require("./routes/emailRoutes");
const authRoutes = require("./routes/authRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");

// Utilities
const {
  uploadToGCS,
  convertWebmToWav,
  checkFileExists,
  computeAudioDuration,
} = require("./utils/utils");

// Services
const {
  googleClient,
  stripeClient,
} = require("./services/googleStripeServices");

// Use routes
app.use("/api/user", userRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/flashcard", flashcardRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/summary", summaryRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/audio", audioRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/newsletter", newsletterRoutes);

// Create the HTTP server using the express app
const server = http.createServer(app);

// Rate Limiting Setup
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
app.use(generalLimiter);

// Subscription Checks
cron.schedule("0 0 * * *", async () => {
  const now = new Date();
  const users = await User.find({
    isSubscriptionActive: true,
    subscriptionEndDate: { $lte: now },
  });

  for (let user of users) {
    user.isSubscriptionActive = false;
    await user.save();
  }
});

// Validation Token
app.post("/api/validateToken", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res
      .status(401)
      .json({ message: "Authorization header is missing." });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, jwtSecret, async (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ message: "Token expired", expired: true });
      } else {
        return res.status(401).json({ message: "Invalid token" });
      }
    }

    try {
      const user = await User.findById(decoded.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({
        valid: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          planId: user.planId,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Error fetching user data", details: error.message });
    }
  });
});

// Protected
app.get("/protected", authenticateUser, (req, res) => {
  res.json({ message: "You have access to this protected route!" });
});
app.get("/", (req, res) => {
  res.send("Server is running.");
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Error in request:", req.path, req.body, err.stack);
  console.error("Error occurred:", err.message);
  console.error("Error stack:", err.stack);
  res.status(500).send("Internal Server Error");

  if (err.message.includes("OpenAI")) {
    res
      .status(500)
      .json({ error: "Error connecting to the summarization service." });
  } else if (err.name === "UnauthorizedError") {
    res.status(401).json({ error: "Unauthorized: Invalid or expired token." });
  } else {
    res
      .status(500)
      .json({ error: err.message || "An unexpected error occurred" });
  }
});

// Server Startup
const start = async () => {
  try {
    await mongoose.connect(
      // "mongodb+srv://amarifields:F2HRZFjgDEJ3Zx4Q@virtunotes.kqftb1z.mongodb.net/?retryWrites=true&w=majority",
      "mongodb+srv://mamtazfreelancer:f7FcczeDomuZ5F3L@cluster0.6ds5s8q.mongodb.net/virtualNotes",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );
    console.log("Connected to MongoDB Atlas");
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB Atlas", error);
  }
};

start();

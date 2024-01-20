const mongoose = require("mongoose");
require("dotenv").config();

const dbUri = process.env.MONGO_URI;

const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://amarifields:F2HRZFjgDEJ3Zx4Q@virtunotes.kqftb1z.mongodb.net/?retryWrites=true&w=majority",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("Error connecting to MongoDB Atlas", error);
    process.exit(1);
  }
};

module.exports = connectDB;

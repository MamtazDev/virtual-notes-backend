const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: String,
  name: String,
  email: { type: String, unique: true },
  password: String,
  planId: String,
  subscriptionId: String,
  isOnTrial: Boolean,
  isGoogleAccount: {
    type: Boolean,
    default: false,
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  savedSummaries: [
    {
      topic: String,
      points: [String],
      date: Date,
    },
  ],
  subscriptionStartDate: Date,
  subscriptionEndDate: Date,
  isSubscriptionActive: { type: Boolean, default: true },
});

// Export the User model
module.exports = mongoose.model("User", UserSchema);

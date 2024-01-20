const mongoose = require("mongoose");

const NewsletterSubscriptionSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  dateSubscribed: { type: Date, default: Date.now },
});

// Export the NewsletterSubscription model
module.exports = mongoose.model(
  "NewsletterSubscription",
  NewsletterSubscriptionSchema
);

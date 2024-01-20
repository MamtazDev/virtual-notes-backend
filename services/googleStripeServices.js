const { OAuth2Client } = require("google-auth-library");
const stripe = require("stripe");

require("dotenv").config();

// Google Client Setup
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Stripe Client Setup
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

module.exports = { googleClient, stripeClient };

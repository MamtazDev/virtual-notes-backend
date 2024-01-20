const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const router = express.Router();

const verify = async (token) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience:
        "228605974535-b8n2532qfielncavgd50qjbg34rs6b56.apps.googleusercontent.com",
    });
    const payload = ticket.getPayload();
    console.log("Google payload:", payload);
    return payload;
  } catch (error) {
    console.error("Error verifying Google token:", error);
    throw error;
  }
};

async function findUserInDatabase(email) {
  try {
    return await User.findOne({ email }).exec();
  } catch (error) {
    console.error("Error finding the user in database:", error);
    throw error;
  }
}

async function createUserInDatabase(googleUser) {
  try {
    const newUser = new User({
      googleId: googleUser.sub,
      email: googleUser.email,
    });

    await newUser.save();
    return newUser;
  } catch (error) {
    console.error("Error creating the user in database:", error);
    throw error;
  }
}

router.post("/api/v1/auth/google", async (req, res) => {
  try {
    const { token } = req.body;
    const googleUser = await verify(token);

    let user = await findUserInDatabase(googleUser.email);

    if (!user) {
      user = await createUserInDatabase(googleUser);
    } else {
      user = await updateUserInDatabase(user, googleUser);
    }

    const jwtPayload = {
      user: { id: user._id, name: user.name, email: user.email },
    };
    const jwtSecret = process.env.JWT_SECRET_KEY;
    const jwtOptions = { expiresIn: "1h" };

    if (!jwtSecret) {
      console.error(
        "JWT secret key is undefined. Make sure JWT_SECRET_KEY is set."
      );
      return res.status(500).json({ message: "Internal server error" });
    }

    const generatedToken = jwt.sign(jwtPayload, jwtSecret, jwtOptions);

    res.status(200).json({
      token: generatedToken,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error("Authentication error:", error);
    if (error.name === "TokenExpiredError") {
      res.status(401).json({ message: "Token has expired" });
    } else if (error.name === "JsonWebTokenError") {
      res.status(401).json({ message: "Invalid token" });
    } else {
      res.status(500).json({ message: "Internal server error" });
    }
  }
});

module.exports = router;

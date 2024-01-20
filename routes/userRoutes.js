const express = require("express");
const router = express.Router();
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { authenticateUser } = require("../middleware/auth");
const { OAuth2Client } = require("google-auth-library");

// Initialize Google OAuth2 Client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// User data route
router.get("/data", authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isGoogleAccount: user.isGoogleAccount,
        planId: user.planId,
        isSubscriptionActive: user.isSubscriptionActive,
        savedSummaries: user.savedSummaries,
      },
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update Plan
router.post("/update-user-plan", authenticateUser, async (req, res) => {
  const { userId, newPlanId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.planId = newPlanId;
    await user.save();

    res.status(200).json({ message: "User plan updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error updating user plan" });
  }
});

// Retrieve User Plan
router.get("/get-user-plan", authenticateUser, async (req, res) => {
  const { userId } = req.query;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ planId: user.planId });
  } catch (error) {
    res.status(500).json({ error: "Error fetching user plan" });
  }
});

router.get("/api/user/has-plan", authenticateUser, async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const hasPlan = user.planId ? true : false;

    return res.status(200).json({ hasPlan: hasPlan });
  } catch (error) {
    console.error("Error checking user plan:", error);
    res.status(500).json({ message: "Error checking user plan" });
  }
});

// Signup route
router.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Email already in use. Please log in." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultPlanId = "defaultPlanId";

    const newUser = new User({
      email,
      password: hashedPassword,
      planId: defaultPlanId,
      isSubscriptionActive: true,
    });

    await newUser.save();

    const payload = { user: { id: newUser._id, email: newUser.email } };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
      expiresIn: "1h",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
      expiresIn: "7d",
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        planId: newUser.planId,
        isSubscriptionActive: newUser.isSubscriptionActive,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Error registering user" });
  }
});

// Login route
router.post("/login", async (req, res) => {
  console.log("Login request received:", req.body);
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        userNotFound: true,
        message: "No account found with this email. Please sign up.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        incorrectPassword: true,
        message: "Incorrect password",
      });
    }

    const payload = { user: { id: user._id } };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
      expiresIn: "15m",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
      expiresIn: "7d",
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
    });

    console.log("JWT and Cookies set for user:", user._id);
    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isGoogleAccount: user.isGoogleAccount,
        planId: user.planId,
        isSubscriptionActive: user.isSubscriptionActive,
        savedSummaries: user.savedSummaries,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error during login." });
  }
});

router.post("/google-login", async (req, res) => {
  const { token: googleToken } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const userid = payload["sub"];

    let user = await User.findOne({ googleId: userid });

    if (!user) {
      user = new User({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        isGoogleAccount: true,
      });
    } else {
      user.isGoogleAccount = true;
    }

    await user.save();

    const userPayload = {
      user: { id: user._id, name: user.name, email: user.email },
    };
    const authToken = jwt.sign(userPayload, process.env.JWT_SECRET_KEY, {
      expiresIn: "1h",
    });

    res.cookie("authToken", authToken, {
      httpOnly: true,
      maxAge: 3600000,
    });

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        planId: user.planId,
        isGoogleAccount: user.isGoogleAccount,
      },
    });
  } catch (e) {
    console.error("Error verifying Google token:", e);
    res.status(401).json({
      message: "Failed to authenticate with Google. Please try again.",
    });
  }
});

// Logout route
router.post("/logout", authenticateUser, (req, res) => {
  res.clearCookie("authToken");
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out successfully" });
});

// Profile update route
router.put("/api/user/update", authenticateUser, async (req, res) => {
  const { email } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "User ID not found in token." });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (user.isGoogleAccount) {
      return res
        .status(400)
        .json({ error: "Google accounts cannot change email." });
    }

    if (email === user.email) {
      return res
        .status(400)
        .json({ error: "New email is the same as the current one." });
    }

    const emailExists = await User.findOne({ email });
    if (emailExists && emailExists._id.toString() !== userId) {
      return res.status(400).json({ error: "Email is already in use." });
    }

    user.email = email;
    await user.save();

    res.json({
      success: true,
      updatedEmail: user.email,
      message: "User profile updated successfully.",
    });
  } catch (error) {
    console.error("Error updating user profile:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Password reset request route
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const resetToken = crypto.randomBytes(20).toString("hex");
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = Date.now() + 3600000;
    await user.save();

    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;

    const mailOptions = {
      from: process.env.USER_NAME,
      to: user.email,
      subject: "Password Reset",
      text: `You requested a password reset. Please go to this link to reset your password: ${resetUrl}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Email sent." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error sending email." });
  }
});

// Password reset route
router.post("/reset-password/:resetToken", async (req, res) => {
  const { resetToken } = req.params;
  const { password } = req.body;

  try {
    const user = await User.findOne({
      passwordResetToken: resetToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ error: "Invalid or expired password reset token." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Your password has been updated." });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while resetting the password." });
  }
});

// Refresh token route
router.post("/refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh Token is required." });
  }

  jwt.verify(
    refreshToken,
    process.env.REFRESH_TOKEN_SECRET,
    async (err, decoded) => {
      if (err) {
        res.clearCookie("refreshToken");
        return res.status(401).json({
          message: "Refresh Token has expired. Please log in again.",
        });
      }

      const newAccessToken = jwt.sign(
        { user: { id: decoded.user.id, email: decoded.user.email } },
        process.env.JWT_SECRET_KEY,
        { expiresIn: "15m" }
      );

      res.cookie("authToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
      });

      const newRefreshToken = generateRefreshToken(decoded.user);
      res.cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({ success: true });
    }
  );
});

const generateRefreshToken = (user) => {
  return jwt.sign({ user }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
};

// Export the router
module.exports = router;

const jwt = require("jsonwebtoken");

const authenticateUser = (req, res, next) => {
  const token = req.cookies ? req.cookies["authToken"] : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          message: "Token expired",
          tokenExpired: true,
          expiredAt: err.expiredAt,
        });
      }
      console.error("Token verification error:", err, "Token:", token);
      return res
        .status(403)
        .json({ message: "Token verification failed", error: err.message });
    }

    req.user = decoded.user;
    next();
  });
};

/**
 * Middleware to limit access to admins.
 */
const isAdmin = (req, res, next) => {
  // Assuming the user's role is stored in the user object and 'admin' signifies an admin user
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

module.exports = { authenticateUser, isAdmin };

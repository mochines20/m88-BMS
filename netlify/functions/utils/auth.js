const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const authenticate = (token) => {
  if (!token) throw new Error('Access denied');
  try {
    return jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
  } catch (err) {
    throw new Error('Invalid token');
  }
};

const authorize = (roles) => {
  return (user) => {
    if (!user || !roles.includes(user.role)) {
      throw new Error('Forbidden');
    }
  };
};

module.exports = { authenticate, authorize };
const crypto = require('crypto');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  
  if (!global._generatedJwtSecret) {
    global._generatedJwtSecret = crypto.randomBytes(64).toString('hex');
    console.warn('WARNING: JWT_SECRET not set. Generated temporary secret. Set JWT_SECRET environment variable for production.');
  }
  return global._generatedJwtSecret;
};

module.exports = {
  secret: getJwtSecret(),
  expiresIn: '7d'
};

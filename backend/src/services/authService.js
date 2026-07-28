const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

function generateOtpCode() {
  // 6-digit numeric code, zero-padded.
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

async function hashOtpCode(code) {
  return bcrypt.hash(code, 10);
}

async function verifyOtpCode(code, codeHash) {
  return bcrypt.compare(code, codeHash);
}

function signSessionToken(orgUser) {
  return jwt.sign(
    { orgUserId: orgUser.id, orgId: orgUser.orgId, role: orgUser.role, email: orgUser.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { generateOtpCode, hashOtpCode, verifyOtpCode, signSessionToken, verifySessionToken };

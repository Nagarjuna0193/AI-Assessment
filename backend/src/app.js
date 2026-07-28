const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const consentRoutes = require('./routes/consentRoutes');
const interviewRoutes = require('./routes/interviewRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// credentials: true + an explicit origin (not '*') so the session cookie can
// be sent cross-origin from the Next.js frontend to this API.
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/consent', consentRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Unexpected server error' });
});

module.exports = app;

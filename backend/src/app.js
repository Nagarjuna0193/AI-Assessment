const express = require('express');
const cors = require('cors');
const consentRoutes = require('./routes/consentRoutes');
const interviewRoutes = require('./routes/interviewRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/consent', consentRoutes);
app.use('/api/interviews', interviewRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Unexpected server error' });
});

module.exports = app;

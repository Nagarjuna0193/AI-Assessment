require('dotenv').config();

// DPDP: consent types a candidate must have granted (and not withdrawn)
// before an interview can be created. Kept to a single type for the pilot —
// see docs/DECISIONS.md.
const REQUIRED_CONSENT_TYPES = ['data_processing'];

module.exports = {
  port: process.env.PORT || 4000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  requiredConsentTypes: REQUIRED_CONSENT_TYPES,
};

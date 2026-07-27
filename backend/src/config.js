require('dotenv').config();

// DPDP: consent types a candidate must have granted (and not withdrawn)
// before an interview can be created. Kept to a single type for the pilot —
// see docs/DECISIONS.md.
const REQUIRED_CONSENT_TYPES = ['data_processing'];

// DPDP: voice interviews additionally require consent to their audio being
// sent to a third-party STT provider — see docs/DECISIONS.md and
// docs/COMPLIANCE.md.
const VOICE_CONSENT_TYPE = 'voice_recording';

function requiredConsentTypesForMode(mode) {
  return mode === 'VOICE' ? [...REQUIRED_CONSENT_TYPES, VOICE_CONSENT_TYPE] : REQUIRED_CONSENT_TYPES;
}

module.exports = {
  port: process.env.PORT || 4000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  requiredConsentTypes: REQUIRED_CONSENT_TYPES,
  voiceConsentType: VOICE_CONSENT_TYPE,
  requiredConsentTypesForMode,
  // STT/TTS provider (OpenAI — see docs/DECISIONS.md for choice + cost).
  sttTtsApiKey: process.env.STT_TTS_PROVIDER_API_KEY,
  sttModel: process.env.STT_MODEL || 'whisper-1',
  ttsModel: process.env.TTS_MODEL || 'tts-1',
  ttsVoice: process.env.TTS_VOICE || 'alloy',
};

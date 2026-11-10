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
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  requiredConsentTypes: REQUIRED_CONSENT_TYPES,
  voiceConsentType: VOICE_CONSENT_TYPE,
  requiredConsentTypesForMode,
  // STT/TTS provider (OpenAI — see docs/DECISIONS.md for choice + cost).
  sttTtsApiKey: process.env.STT_TTS_PROVIDER_API_KEY,
  sttModel: process.env.STT_MODEL || 'whisper-1',
  ttsModel: process.env.TTS_MODEL || 'tts-1',
  ttsVoice: process.env.TTS_VOICE || 'alloy',
  // Org-user auth (Phase 4.5) — email/OTP, JWT session cookie. See
  // docs/DECISIONS.md for the JWT-vs-session-store choice.
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES) || 10,
  sessionCookieName: 'org_session',
  // Email delivery for OTP codes (Resend REST API — see docs/DECISIONS.md).
  // Falls back to logging the code to the console when unset, so local dev
  // and tests work without a real provider.
  authEmailProviderApiKey: process.env.AUTH_EMAIL_PROVIDER_API_KEY,
  authEmailFrom: process.env.AUTH_EMAIL_FROM || 'no-reply@ai-interview-bot.local',
  // Shared secret for ops-only endpoints (org/org_user creation, credit
  // grants) — deliberately NOT the org_user JWT, since these actions must
  // stay ops-initiated, not self-serve. See docs/DECISIONS.md.
  opsApiKey: process.env.OPS_API_KEY,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Resume file storage (Phase 4.6) — Supabase Storage, chosen to share a
  // vendor with the Postgres DB at pilot scale. See docs/DECISIONS.md. Falls
  // back to local disk when unset, so local dev/tests don't need a bucket.
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseResumeBucket: process.env.SUPABASE_RESUME_BUCKET || 'resumes',
  localUploadsDir: process.env.LOCAL_UPLOADS_DIR || 'uploads',
};

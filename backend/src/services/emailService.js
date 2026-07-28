const config = require('../config');

// Resend's REST API (single fetch call, no SDK dependency) — see
// docs/DECISIONS.md for why Resend was picked over a full SMTP/nodemailer
// setup for a pilot this size. Falls back to a console log when no API key
// is configured, so local dev and the test suite never need a real provider.
async function sendOtpEmail(email, code) {
  if (!config.authEmailProviderApiKey) {
    // eslint-disable-next-line no-console
    console.log(`[dev] OTP for ${email}: ${code} (expires in ${config.otpTtlMinutes} min)`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.authEmailProviderApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.authEmailFrom,
      to: email,
      subject: 'Your login code',
      text: `Your login code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send OTP email: ${res.status} ${body}`);
  }
}

module.exports = { sendOtpEmail };

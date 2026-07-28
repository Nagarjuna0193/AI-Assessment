const fs = require('fs/promises');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let client = null;
function getClient() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return client;
}

// Stores the original resume file so it can be retrieved later if needed
// (e.g. a human-review request) — only the extracted text is used for
// scoring/evaluation, per DPDP data minimization; see docs/DECISIONS.md.
// Returns a `resumeFileRef` string to store on the candidate_session.
async function uploadResumeFile(sessionId, buffer, filename) {
  const key = `${sessionId}/${Date.now()}-${filename}`;

  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    const { error } = await getClient()
      .storage.from(config.supabaseResumeBucket)
      .upload(key, buffer, { upsert: true });

    if (error) {
      throw new Error(`Failed to upload resume to Supabase Storage: ${error.message}`);
    }

    return `supabase://${config.supabaseResumeBucket}/${key}`;
  }

  // Local-disk fallback for dev/test environments without a Supabase
  // project configured — see docs/DECISIONS.md.
  const dir = path.join(config.localUploadsDir, 'resumes', sessionId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${filename}`);
  await fs.writeFile(filePath, buffer);

  return `local://${filePath}`;
}

module.exports = { uploadResumeFile };

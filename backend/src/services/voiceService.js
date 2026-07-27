const OpenAI = require('openai');
const config = require('../config');

class VoiceProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VoiceProviderError';
  }
}

// Constructed lazily (not at module load) so requiring this module doesn't
// throw in environments/tests where STT_TTS_PROVIDER_API_KEY isn't set —
// the error only surfaces when a voice feature is actually used.
let client;
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: config.sttTtsApiKey });
  }
  return client;
}

// STT: transcribe a candidate's spoken answer to text.
async function transcribeAudio(buffer, filename, mimeType) {
  try {
    const file = await OpenAI.toFile(buffer, filename || 'answer.webm', {
      type: mimeType || 'audio/webm',
    });
    const result = await getClient().audio.transcriptions.create({
      file,
      model: config.sttModel,
    });
    return { text: result.text, model: config.sttModel };
  } catch (err) {
    throw new VoiceProviderError(`STT transcription failed: ${err.message}`);
  }
}

// TTS: synthesize a question's text so it can be read aloud to the candidate.
async function synthesizeSpeech(text) {
  try {
    const response = await getClient().audio.speech.create({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
    });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return { audioBuffer, contentType: 'audio/mpeg', model: config.ttsModel };
  } catch (err) {
    throw new VoiceProviderError(`TTS synthesis failed: ${err.message}`);
  }
}

module.exports = { transcribeAudio, synthesizeSpeech, VoiceProviderError };

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

class UnsupportedFileTypeError extends Error {
  constructor(filename) {
    super(`Unsupported file type: ${filename}`);
  }
}

// Text extraction shared by resume upload (candidate flow) and JD file
// upload (Create Interview admin page) — see docs/DECISIONS.md.
async function extractText(buffer, filename, mimetype) {
  const lower = (filename || '').toLowerCase();

  if (mimetype === 'application/pdf' || lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  throw new UnsupportedFileTypeError(filename);
}

module.exports = { extractText, UnsupportedFileTypeError };

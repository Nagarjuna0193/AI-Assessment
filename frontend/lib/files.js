// Client-side pre-checks for PDF/DOCX uploads. The server (multer, 15 MB
// limit in backend/src/routes/*Routes.js) remains the authority; this just
// gives an immediate message instead of a failed upload.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx'];

export function validateDocumentFile(file) {
  if (!file) return null;
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return 'Please choose a PDF or DOCX file.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'That file is larger than 15 MB. Please choose a smaller file.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}

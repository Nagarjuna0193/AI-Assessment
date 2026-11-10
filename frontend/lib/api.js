const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || (body && body.error) || `Request failed with ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // Needed so the org_session cookie (set by /api/auth/verify-otp) is sent
    // back on the reviewer dashboard's requests to the API origin.
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

// Shared by any multipart upload (resume, JD file, voice answer) — no
// Content-Type header here, the browser sets the multipart boundary.
async function requestFormData(path, formData, method = 'POST') {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    body: formData,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  recordConsent: (payload) => request('/api/consent', { method: 'POST', body: payload }),

  // Auth (org_user login)
  requestOtp: (email) => request('/api/auth/request-otp', { method: 'POST', body: { email } }),
  verifyOtp: (email, code) => request('/api/auth/verify-otp', { method: 'POST', body: { email, code } }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
  me: () => request('/api/auth/me'),

  // Reviewer dashboard (org-authenticated) — templates + candidate sessions
  listTemplates: () => request('/api/interviews'),
  getSessionDetail: (sessionId) => request(`/api/interviews/${sessionId}`),
  evaluateSession: (sessionId) => request(`/api/interviews/${sessionId}/evaluate`, { method: 'POST', body: {} }),

  // Create Interview admin page (org ADMIN only)
  createTemplate: (formData) => requestFormData('/api/templates', formData),
  inviteCandidate: (templateId, payload) =>
    request(`/api/templates/${templateId}/sessions`, { method: 'POST', body: payload }),
  bulkInviteCandidates: (templateId, candidates) =>
    request(`/api/templates/${templateId}/sessions/bulk`, { method: 'POST', body: { candidates } }),

  // Candidate flow (unauthenticated, addressed by invite token)
  getSession: (token) => request(`/api/sessions/${token}`),
  startSession: (token, payload) => request(`/api/sessions/${token}/start`, { method: 'POST', body: payload }),
  uploadResume: (token, file) => {
    const formData = new FormData();
    formData.append('resume', file);
    return requestFormData(`/api/sessions/${token}/resume`, formData);
  },
  submitSessionAnswer: (token, payload) =>
    request(`/api/sessions/${token}/answers`, { method: 'POST', body: payload }),
  transcribeSessionAnswer: (token, audioBlob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'answer.webm');
    return requestFormData(`/api/sessions/${token}/answers/transcribe`, formData);
  },
  sessionQuestionAudioUrl: (token, questionId) =>
    `${API_BASE_URL}/api/sessions/${token}/questions/${questionId}/audio`,
};

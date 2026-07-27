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
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

async function transcribeAnswer(interviewId, audioBlob) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'answer.webm');

  // No Content-Type header here — the browser sets the multipart boundary.
  const res = await fetch(`${API_BASE_URL}/api/interviews/${interviewId}/answers/transcribe`, {
    method: 'POST',
    body: formData,
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
  createInterview: (payload) => request('/api/interviews', { method: 'POST', body: payload }),
  submitAnswer: (interviewId, payload) =>
    request(`/api/interviews/${interviewId}/answers`, { method: 'POST', body: payload }),
  evaluateInterview: (interviewId) =>
    request(`/api/interviews/${interviewId}/evaluate`, { method: 'POST', body: {} }),
  listInterviews: () => request('/api/interviews'),
  getInterview: (interviewId) => request(`/api/interviews/${interviewId}`),
  transcribeAnswer,
  questionAudioUrl: (interviewId, questionId) =>
    `${API_BASE_URL}/api/interviews/${interviewId}/questions/${questionId}/audio`,
};

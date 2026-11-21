import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Alert, Icon, Spinner } from './ui';

// Voice is an alternative input/output for the existing text answer flow:
// recording fills the same textarea (via onTranscribed) rather than
// submitting directly, and any failure here just leaves typing available.
export default function VoiceControls({ token, questionId, onTranscribed, disabled }) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioElRef = useRef(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices);
  }, []);

  useEffect(() => {
    setError(null);
    setRecording(false);
    setTranscribing(false);
    setPlaying(false);
    setElapsed(0);
  }, [questionId]);

  // Recording timer, so the candidate can see the mic is live.
  useEffect(() => {
    if (!recording) return undefined;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(
    () => () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const { text } = await api.transcribeSessionAnswer(token, blob);
          onTranscribed(text);
        } catch (err) {
          setError(
            err instanceof ApiError
              ? `Couldn't transcribe your answer (${err.message}). Please type it instead.`
              : "Couldn't transcribe your answer. Please type it instead."
          );
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setElapsed(0);
      setRecording(true);
    } catch {
      setError('Microphone access is unavailable. Allow microphone access in your browser, or type your answer instead.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const playQuestion = () => {
    setError(null);
    if (!audioElRef.current) return;
    audioElRef.current.src = api.sessionQuestionAudioUrl(token, questionId);
    setPlaying(true);
    audioElRef.current.play().catch(() => {
      setPlaying(false);
      setError("Couldn't play the question audio. The question is shown above.");
    });
  };

  if (!supported) {
    return (
      <Alert tone="info" className="mb-4">
        Voice recording isn&apos;t supported in this browser. Please type your answer below.
      </Alert>
    );
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={playQuestion} disabled={playing} className="btn btn-secondary btn-sm">
          {playing ? <Spinner /> : <Icon name="speaker" />}
          {playing ? 'Playing…' : 'Play question'}
        </button>
        {/* Question text is on screen, so the audio needs no captions. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={audioElRef}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setError("Couldn't play the question audio. The question is shown above.");
          }}
        />

        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled || transcribing}
            className="btn btn-primary btn-sm"
          >
            {transcribing ? <Spinner /> : <Icon name="mic" />}
            {transcribing ? 'Transcribing…' : 'Record answer'}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="btn btn-sm border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
          >
            <Icon name="stop" />
            Stop recording
          </button>
        )}

        <span aria-live="polite" className="text-sm text-slate-600">
          {recording && (
            <span className="inline-flex items-center gap-2 font-medium text-rose-700">
              <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rose-600" />
              Recording
              <span className="font-mono tabular-nums" aria-hidden="true">
                {mm}:{ss}
              </span>
            </span>
          )}
          {transcribing && 'Converting your answer to text…'}
        </span>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

// Voice is an alternative input/output for the existing text answer flow:
// recording fills the same textarea (via onTranscribed) rather than
// submitting directly, and any failure here just leaves typing available.
export default function VoiceControls({ interviewId, questionId, onTranscribed, disabled }) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
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
  }, [questionId]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const { text } = await api.transcribeAnswer(interviewId, blob);
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
      setRecording(true);
    } catch {
      setError('Microphone access unavailable. Please type your answer instead.');
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
    audioElRef.current.src = api.questionAudioUrl(interviewId, questionId);
    setPlaying(true);
    audioElRef.current.play().catch(() => {
      setPlaying(false);
      setError("Couldn't play the question audio.");
    });
  };

  if (!supported) {
    return (
      <p className="text-xs text-slate-400 mb-3">
        Voice recording isn&apos;t supported in this browser — please type your answer below.
      </p>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={playQuestion}
        disabled={playing}
        className="text-sm border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
      >
        {playing ? 'Playing…' : '🔊 Play question'}
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioElRef}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError("Couldn't play the question audio.");
        }}
      />

      {!recording ? (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled || transcribing}
          className="text-sm border border-slate-300 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
        >
          {transcribing ? 'Transcribing…' : '🎤 Record answer'}
        </button>
      ) : (
        <button
          type="button"
          onClick={stopRecording}
          className="text-sm border border-red-300 text-red-700 rounded-md px-3 py-1.5 hover:bg-red-50"
        >
          ⏹ Stop recording
        </button>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

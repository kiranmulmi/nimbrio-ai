// Voice input for the message box, with the browser's own speech recognition (Web Speech
// API). Chrome sends the audio to its speech service and Safari to Apple's; Firefox has none,
// so the mic button isn't shown there. One utterance at a time: it ends when you stop
// speaking, and the text goes into the box (never sent on its own).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The part of the API used here (TypeScript's DOM types don't include it). */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult | undefined };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** With a track (Chrome 135+), listens to that microphone; older browsers ignore it. */
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can turn speech into text (Chrome, Edge, Safari; not Firefox). */
export const isSpeechInputSupported = (): boolean => recognitionConstructor() !== null;

/** What has been heard so far in one listening session, phrase by phrase. */
export type HeardPhrase = { text: string; isFinal: boolean };

export interface RecognitionHandle {
  /** Stops listening; what was heard is still reported, then `onEnd`. */
  stop(): void;
  /** Stops at once and reports nothing more, not even `onEnd`. */
  abort(): void;
}

/**
 * One listening session for code that drives the flow itself (voice mode). `continuous`
 * keeps listening across pauses (each pause finishes a phrase) instead of ending at the first.
 * Returns null where the browser has none or it couldn't start.
 */
export function startRecognition({
  continuous,
  micId,
  onHeard,
  onEnd,
  onError,
}: {
  continuous: boolean;
  /**
   * The microphone to listen to (an audio input deviceId); empty uses the system default.
   * It's opened first and its track handed to recognition; if it can't be opened (unplugged,
   * blocked), the default microphone is used instead.
   */
  micId?: string;
  onHeard: (phrases: HeardPhrase[]) => void;
  onEnd: () => void;
  onError?: (message: string, code: string) => void;
}): RecognitionHandle | null {
  const Constructor = recognitionConstructor();
  if (!Constructor) return null;
  const rec = new Constructor();
  rec.lang = navigator.language || 'en-US';
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    const phrases: HeardPhrase[] = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = (result?.[0]?.transcript ?? '').trim();
      if (text) phrases.push({ text, isFinal: Boolean(result?.isFinal) });
    }
    onHeard(phrases);
  };
  rec.onerror = (event) => {
    if (event.error !== 'aborted') {
      onError?.(ERROR_TEXT[event.error] ?? `Voice input stopped: ${event.error}.`, event.error);
    }
  };
  // The chosen microphone's stream, released when listening ends.
  let stream: MediaStream | null = null;
  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  rec.onend = () => {
    release();
    onEnd();
  };

  const canPickMic =
    Boolean(micId) && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
  if (!canPickMic) {
    try {
      rec.start();
    } catch {
      return null;
    }
    return {
      stop: () => rec.stop(),
      abort: () => {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      },
    };
  }

  // A chosen microphone: open it first, then start (stop/abort before then still work).
  let state: 'opening' | 'started' | 'stopped' = 'opening';
  const begin = (track?: MediaStreamTrack) => {
    if (state !== 'opening') {
      release();
      return;
    }
    state = 'started';
    try {
      if (track) rec.start(track);
      else rec.start();
    } catch {
      try {
        // A browser that refuses the track: the default microphone instead.
        release();
        rec.start();
      } catch {
        release();
        onError?.("Voice input couldn't start. Try again.", 'start-failed');
        onEnd();
      }
    }
  };
  navigator.mediaDevices
    .getUserMedia({ audio: { deviceId: { exact: micId } } })
    .then((opened) => {
      stream = opened;
      begin(opened.getAudioTracks()[0]);
    })
    .catch(() => begin());
  return {
    stop: () => {
      if (state === 'started') rec.stop();
      else if (state === 'opening') {
        state = 'stopped';
        onEnd();
      }
    },
    abort: () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      if (state === 'started') rec.abort();
      state = 'stopped';
      release();
    },
  };
}

/** One microphone the browser can listen to. */
export type MicDevice = { id: string; label: string };

/**
 * The microphones, for the settings picker. Their names only show once the page may use the
 * microphone (`hasLabels`); `askAccess` asks for it and lists them again.
 */
export function useMicrophones() {
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [hasLabels, setHasLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.enumerateDevices);

  const load = useCallback(async () => {
    if (!isSupported) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (device) => device.kind === 'audioinput' && device.deviceId !== 'default',
      );
      setHasLabels(inputs.some((device) => device.label));
      setMics(
        inputs.map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        })),
      );
    } catch {
      setError("Couldn't list the microphones.");
    }
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) return;
    void load();
    const media = navigator.mediaDevices;
    const reload = () => void load();
    media.addEventListener('devicechange', reload);
    return () => media.removeEventListener('devicechange', reload);
  }, [isSupported, load]);

  const askAccess = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await load();
    } catch {
      setError(ERROR_TEXT['not-allowed'] ?? 'Microphone access is blocked.');
    }
  }, [load]);

  return { isSupported, mics, hasLabels, error, askAccess, reload: load };
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar.',
  'service-not-allowed': 'Microphone access is blocked. Allow it from the icon in the address bar.',
  'audio-capture': 'No microphone was found.',
  'no-speech': "Didn't hear anything. Try again.",
  network: 'Voice input needs an internet connection (the browser turns speech into text online).',
  'language-not-supported': "The browser can't recognise speech in this language.",
};

/**
 * Listens for one utterance and hands its text to `onText` when you stop speaking.
 * `interim` is what has been heard so far, for showing while you speak.
 */
export function useSpeechInput(onText: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const deliver = useRef(onText);
  useLayoutEffect(() => {
    deliver.current = onText;
  }, [onText]);

  const isSupported = isSpeechInputSupported();

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor || recognition.current) return;
    const rec = new Constructor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false; // ends by itself after a pause
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (event) => {
      let heard = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += text;
        else heard += text;
      }
      setInterim((finalText + heard).trim());
    };
    rec.onerror = (event) => {
      // "aborted" is our own stop on leaving; nothing to tell.
      if (event.error !== 'aborted') {
        setError(ERROR_TEXT[event.error] ?? `Voice input stopped: ${event.error}.`);
      }
    };
    rec.onend = () => {
      recognition.current = null;
      setIsListening(false);
      setInterim('');
      const text = finalText.trim();
      if (text) deliver.current(text);
    };
    setError(null);
    setInterim('');
    recognition.current = rec;
    setIsListening(true);
    try {
      rec.start();
    } catch {
      recognition.current = null;
      setIsListening(false);
      setError("Voice input couldn't start. Try again.");
    }
  }, []);

  // Leaving the chat (or the page) stops listening without using what was heard.
  useEffect(
    () => () => {
      const rec = recognition.current;
      if (!rec) return;
      rec.onend = null;
      rec.abort();
    },
    [],
  );

  return {
    isSupported,
    isListening,
    interim,
    error,
    start,
    stop,
    clearError: () => setError(null),
  };
}

// Reading replies aloud in voice mode, with the browser's own speech voices (Web Speech API
// speechSynthesis). Sentences are queued as they stream in; `cancel` cuts it off. The voice
// can be chosen (remembered as a UI preference); by default the most human-sounding one for
// the page's language is used.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoicePrefs } from './voicePrefs';

const hasSynthesis = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Whether this browser can read text aloud. */
export const isSpeechOutputSupported = (): boolean => hasSynthesis();

/**
 * How human a voice sounds, from its name: Edge's "Natural" / "Online" neural voices and
 * macOS's Premium / Enhanced ones are close to a person; Chrome's Google voices are good; the
 * old system voices (macOS's Fred, Albert, ...) are robotic.
 */
function naturalness(voice: SpeechSynthesisVoice): number {
  const name = voice.name;
  if (/natural|neural|premium/i.test(name)) return 4;
  if (/enhanced|online/i.test(name)) return 3;
  if (/google/i.test(name)) return 2;
  if (/^(samantha|alex|daniel|karen|moira|serena|tessa|rishi|ava|allison|susan|tom)\b/i.test(name))
    return 1;
  return 0;
}

/** Voices for the page's language, the most natural first. */
export function voicesFor(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const lang = (navigator.language || 'en-US').toLowerCase();
  const base = lang.split('-')[0] ?? lang;
  return all
    .filter((voice) => voice.lang.toLowerCase().startsWith(base))
    .sort(
      (a, b) =>
        naturalness(b) - naturalness(a) ||
        Number(b.lang.toLowerCase() === lang) - Number(a.lang.toLowerCase() === lang) ||
        a.name.localeCompare(b.name),
    );
}

export function useSpeechOutput() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // The voice, speed and pitch come from the workspace settings (this browser's prefs).
  const [{ voiceName, rate, pitch }] = useVoicePrefs();
  const tuning = useRef({ rate, pitch });
  useEffect(() => {
    tuning.current = { rate, pitch };
  }, [rate, pitch]);
  const queued = useRef(0);
  // Bumped by cancel, so the events of cut-off sentences are ignored.
  const generation = useRef(0);
  // Chrome drops the events of an utterance nothing refers to, so they're kept until done.
  const live = useRef(new Set<SpeechSynthesisUtterance>());
  const isSupported = hasSynthesis();

  useEffect(() => {
    if (!hasSynthesis()) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(voicesFor(synth.getVoices()));
    load(); // Safari has them now; Chrome loads them and says so with voiceschanged
    synth.addEventListener('voiceschanged', load);
    return () => {
      synth.removeEventListener('voiceschanged', load);
      synth.cancel(); // leaving the chat stops talking
    };
  }, []);

  /** The chosen voice, or the most natural one. */
  const voice = voices.find((item) => item.name === voiceName) ?? voices[0] ?? null;
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  /** Queues one sentence; `onStart` runs when it starts being said. */
  const speak = useCallback((text: string, onStart?: () => void) => {
    if (!hasSynthesis() || !text.trim()) return;
    const synth = window.speechSynthesis;
    const round = generation.current;
    const chosen = voiceRef.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = chosen?.lang ?? (navigator.language || 'en-US');
    if (chosen) utterance.voice = chosen;
    utterance.rate = tuning.current.rate;
    utterance.pitch = tuning.current.pitch;
    const isCurrent = () => round === generation.current;
    const done = () => {
      live.current.delete(utterance);
      if (!isCurrent()) return;
      queued.current = Math.max(0, queued.current - 1);
      if (queued.current === 0) setIsSpeaking(false);
    };
    utterance.onend = done;
    utterance.onerror = done;
    utterance.onstart = () => {
      if (isCurrent()) onStart?.();
    };
    live.current.add(utterance);
    queued.current += 1;
    setIsSpeaking(true);
    synth.resume(); // Chrome can be left paused, and then says nothing
    synth.speak(utterance);
  }, []);

  /** Stops talking now and forgets the queue. */
  const cancel = useCallback(() => {
    generation.current += 1;
    queued.current = 0;
    live.current.clear();
    setIsSpeaking(false);
    if (hasSynthesis()) window.speechSynthesis.cancel();
  }, []);

  /** Still has sentences to say (current right away, unlike `isSpeaking`). */
  const hasQueue = useCallback(() => queued.current > 0, []);

  return { isSupported, isSpeaking, speak, cancel, hasQueue };
}

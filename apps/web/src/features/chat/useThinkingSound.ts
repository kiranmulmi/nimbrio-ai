// While voice mode waits on the agent (thinking, running tools) a soft bubble-pop clip
// (public/sounds/thinking.mp3) loops, so the silence doesn't sound like it hung. It's played
// with Web Audio rather than an <audio loop> element, which leaves a gap at each repeat.
import { useEffect } from 'react';

const SOUND_URL = '/sounds/thinking.mp3';
/** Short gaps between spoken sentences stay silent; only a real wait starts the sound. */
const START_DELAY_MS = 700;
const VOLUME = 0.5;
/** Fade in and out (seconds), so it never starts or stops with a click. */
const FADE = 0.15;

// One context for the page (browsers cap how many there can be), suspended while silent.
let shared: AudioContext | null = null;
let playing = 0;
// The clip, fetched and decoded once.
let clip: Promise<AudioBuffer> | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  shared ??= new window.AudioContext();
  return shared;
}

function loadClip(context: AudioContext): Promise<AudioBuffer> {
  clip ??= fetch(SOUND_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Thinking sound: HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data));
  // A failed load is tried again next time instead of staying silent for good.
  clip.catch(() => {
    clip = null;
  });
  return clip;
}

/** Loops the thinking sound while `isOn`; it fades out when it turns off. */
export function useThinkingSound(isOn: boolean) {
  useEffect(() => {
    if (!isOn) return;
    let isStopped = false;
    let source: AudioBufferSourceNode | null = null;
    let master: GainNode | null = null;
    const context = audioContext();
    if (!context) return;
    // Decode while the start delay runs, so it starts on time.
    const loading = loadClip(context);
    const delay = window.setTimeout(() => {
      void loading
        .then((buffer) => {
          if (isStopped) return;
          playing += 1;
          void context.resume();
          const out = context.createGain();
          out.gain.setValueAtTime(0, context.currentTime);
          out.gain.linearRampToValueAtTime(VOLUME, context.currentTime + FADE);
          out.connect(context.destination);
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.loop = true;
          node.connect(out);
          node.start();
          source = node;
          master = out;
        })
        .catch(() => undefined); // no sound file: wait in silence
    }, START_DELAY_MS);

    return () => {
      isStopped = true;
      window.clearTimeout(delay);
      const node = source;
      const out = master;
      if (!node || !out) return;
      out.gain.cancelScheduledValues(context.currentTime);
      out.gain.setValueAtTime(out.gain.value, context.currentTime);
      out.gain.linearRampToValueAtTime(0, context.currentTime + FADE);
      node.stop(context.currentTime + FADE + 0.02);
      window.setTimeout(
        () => {
          out.disconnect();
          playing = Math.max(0, playing - 1);
          if (playing === 0) void context.suspend();
        },
        (FADE + 0.1) * 1000,
      );
    };
  }, [isOn]);
}

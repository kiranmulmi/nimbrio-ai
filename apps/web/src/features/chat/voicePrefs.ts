// Voice mode's device choices: the microphone, the reply voice and how fast / high it speaks.
// They belong to this browser (device ids and installed voices differ per machine), so they
// are UI preferences in localStorage, not workspace data. Writing one tells every open hook,
// so the voice bar under the settings popup picks up a change saved there right away.
import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from '../../lib/storage';

export type VoicePrefs = {
  /** speechSynthesis voice name; '' picks the most natural one */
  voiceName: string;
  /** speaking speed, 0.5 to 2 (1 is normal) */
  rate: number;
  /** voice pitch, 0.5 to 1.5 (1 is normal) */
  pitch: number;
  /** audio input deviceId; '' uses the system default */
  micId: string;
};

const KEYS: Record<keyof VoicePrefs, string> = {
  voiceName: 'agent.voiceName',
  rate: 'agent.voiceRate',
  pitch: 'agent.voicePitch',
  micId: 'agent.micId',
};

export const RATE_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;
export const PITCH_RANGE = { min: 0.5, max: 1.5, step: 0.1 } as const;

const EVENT = 'agent:voice-prefs';

function readNumber(key: string, range: { min: number; max: number }): number {
  const value = Number(readPref(key));
  if (!Number.isFinite(value) || value === 0) return 1;
  return Math.min(range.max, Math.max(range.min, value));
}

export function readVoicePrefs(): VoicePrefs {
  return {
    voiceName: readPref(KEYS.voiceName) ?? '',
    rate: readNumber(KEYS.rate, RATE_RANGE),
    pitch: readNumber(KEYS.pitch, PITCH_RANGE),
    micId: readPref(KEYS.micId) ?? '',
  };
}

export function writeVoicePrefs(next: Partial<VoicePrefs>): void {
  for (const key of Object.keys(next) as Array<keyof VoicePrefs>) {
    const value = next[key];
    if (value !== undefined) writePref(KEYS[key], String(value));
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The saved voice choices, kept current when they change anywhere in the app. */
export function useVoicePrefs(): [VoicePrefs, (next: Partial<VoicePrefs>) => void] {
  const [prefs, setPrefs] = useState(readVoicePrefs);
  useEffect(() => {
    const reload = () => setPrefs(readVoicePrefs());
    window.addEventListener(EVENT, reload);
    return () => window.removeEventListener(EVENT, reload);
  }, []);
  const update = useCallback((next: Partial<VoicePrefs>) => writeVoicePrefs(next), []);
  return [prefs, update];
}

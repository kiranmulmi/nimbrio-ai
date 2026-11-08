import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { HINT, INPUT, INPUT_OK, LABEL } from '../../components/form';
import { MicIcon, StopIcon } from '../../lib/icons';
import { useMicrophones } from '../chat/useSpeechInput';
import { isSpeechOutputSupported, voicesFor } from '../chat/useSpeechOutput';
import { PITCH_RANGE, RATE_RANGE, type VoicePrefs } from '../chat/voicePrefs';
import { useMicTest } from './useMicTest';

const SAMPLE = 'Hi! This is how I sound.';

/** The browser's voices for the page language, the most natural first (they load late in Chrome). */
function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!isSpeechOutputSupported()) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(voicesFor(synth.getVoices()));
    load();
    synth.addEventListener('voiceschanged', load);
    return () => {
      synth.removeEventListener('voiceschanged', load);
      synth.cancel();
    };
  }, []);
  return voices;
}

function playSample(voice: SpeechSynthesisVoice | undefined, rate: number, pitch: number) {
  if (!isSpeechOutputSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(SAMPLE);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  utterance.pitch = pitch;
  synth.resume();
  synth.speak(utterance);
}

/**
 * Voice mode's microphone, reply voice, speed and pitch. Controlled by the workspace form,
 * which saves them as this browser's preferences (devices and voices differ per machine).
 */
export function VoiceSettings({
  value,
  onChange,
}: {
  value: VoicePrefs;
  onChange: (next: Partial<VoicePrefs>) => void;
}) {
  const voices = useVoices();
  const {
    isSupported: canListMics,
    mics,
    hasLabels,
    error: micError,
    askAccess,
    reload: reloadMics,
  } = useMicrophones();
  const chosenVoice = voices.find((voice) => voice.name === value.voiceName);
  const isMicMissing =
    value.micId !== '' && hasLabels && !mics.some((mic) => mic.id === value.micId);
  const micTest = useMicTest(isMicMissing ? '' : value.micId, () => {
    if (!hasLabels) void reloadMics();
  });

  return (
    <div className="mt-3 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <label htmlFor="voice-mic" className={LABEL}>
          Microphone
        </label>
        {canListMics ? (
          <>
            <div className="flex items-start gap-2">
              <select
                id="voice-mic"
                value={isMicMissing ? '' : value.micId}
                onChange={(event) => onChange({ micId: event.target.value })}
                className={`${INPUT} ${INPUT_OK} min-w-0 flex-1`}
              >
                <option value="">System default</option>
                {mics.map((mic) => (
                  <option key={mic.id} value={mic.id}>
                    {mic.label}
                  </option>
                ))}
              </select>
              {!hasLabels && !micTest.isTesting && (
                <Button className="mt-2 h-[38px] shrink-0" onClick={() => void askAccess()}>
                  <MicIcon size={14} /> Allow access
                </Button>
              )}
              {micTest.isSupported && (
                <Button
                  className="mt-2 h-[38px] shrink-0"
                  variant={micTest.isTesting ? 'soft' : 'ghost'}
                  onClick={micTest.isTesting ? micTest.stop : micTest.start}
                  aria-pressed={micTest.isTesting}
                >
                  {micTest.isTesting ? (
                    <>
                      <StopIcon size={12} /> Stop test
                    </>
                  ) : (
                    <>
                      <MicIcon size={14} /> Test
                    </>
                  )}
                </Button>
              )}
            </div>
            {micTest.isTesting && (
              <div className="mt-2.5 flex items-center gap-3">
                <div
                  className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2"
                  role="meter"
                  aria-label="Microphone input level"
                >
                  <div
                    ref={micTest.meterRef}
                    className="h-full w-0 rounded-full bg-accent transition-[width] duration-75"
                  />
                </div>
                <span
                  className={`shrink-0 text-[12.5px] ${micTest.heard ? 'text-accent-2' : 'text-ink-3'}`}
                  aria-live="polite"
                >
                  {micTest.heard ? 'Hearing you ✓' : 'Say something…'}
                </span>
              </div>
            )}
            <p className={micError || micTest.error ? 'mt-1.5 text-[13px] text-warn' : HINT}>
              {micTest.error ??
                micError ??
                (isMicMissing
                  ? 'The microphone chosen before isn’t connected; the system default is used.'
                  : !hasLabels
                    ? 'Allow microphone access to see the microphones by name.'
                    : 'Voice mode listens to this one. Chrome 135 and later can pick it; other browsers use the system default.')}
            </p>
          </>
        ) : (
          <p className={HINT}>This browser can’t list microphones; the system default is used.</p>
        )}
      </div>

      <div>
        <label htmlFor="voice-name" className={LABEL}>
          Voice
        </label>
        {voices.length > 0 ? (
          <div className="flex items-start gap-2">
            <select
              id="voice-name"
              value={chosenVoice ? chosenVoice.name : ''}
              onChange={(event) => onChange({ voiceName: event.target.value })}
              className={`${INPUT} ${INPUT_OK} min-w-0 flex-1`}
            >
              <option value="">Automatic (most natural: {voices[0]?.name})</option>
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                  {voice.localService ? '' : ' (online)'}
                </option>
              ))}
            </select>
            <Button
              className="mt-2 h-[38px] shrink-0"
              onClick={() => playSample(chosenVoice ?? voices[0], value.rate, value.pitch)}
            >
              Play sample
            </Button>
          </div>
        ) : (
          <p className={HINT}>
            {isSpeechOutputSupported()
              ? 'Loading the browser’s voices…'
              : 'This browser can’t read replies aloud.'}
          </p>
        )}
        <p className={HINT}>
          Replies are read in this voice. The chat’s voice bar can change it too.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Slider
          id="voice-rate"
          label="Speed"
          value={value.rate}
          range={RATE_RANGE}
          onChange={(rate) => onChange({ rate })}
        />
        <Slider
          id="voice-pitch"
          label="Pitch"
          value={value.pitch}
          range={PITCH_RANGE}
          onChange={(pitch) => onChange({ pitch })}
        />
      </div>
      <p className="-mt-2 text-[12.5px] text-ink-3">
        Saved for this browser only, since microphones and voices differ per device.
      </p>
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  range,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <button
          type="button"
          onClick={() => onChange(1)}
          disabled={value === 1}
          className="text-[12px] tabular-nums text-ink-3 hover:text-ink disabled:hover:text-ink-3"
          title={value === 1 ? undefined : 'Reset to normal'}
        >
          {value.toFixed(1)}×
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
      />
    </div>
  );
}

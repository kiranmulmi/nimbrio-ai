import { useCallback, useEffect, useRef, useState } from 'react';

/** Above this level (0–1 on the meter) counts as hearing something. */
const HEARD_LEVEL = 0.35;

/** The meter shows -60 dB … 0 dB. */
const FLOOR_DB = -60;

function errorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it from the icon in the address bar.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'That microphone wasn’t found. Is it connected?';
    case 'NotReadableError':
      return 'The microphone is busy or unavailable (another app may be using it).';
    default:
      return 'The microphone couldn’t start. Try again.';
  }
}

/**
 * A live test of one microphone (`micId`, '' for the system default): `start` opens it and
 * drives `meterRef`'s width with its input level each frame (no re-render per frame), `heard`
 * turns on once it picks something up. Switching `micId` mid-test reopens the new one;
 * `stop`, and unmounting, release the microphone.
 */
export function useMicTest(micId: string, onAccessGranted?: () => void) {
  const [isTesting, setIsTesting] = useState(false);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const runRef = useRef(0);
  const onAccessRef = useRef(onAccessGranted);
  onAccessRef.current = onAccessGranted;

  const isSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof window.AudioContext !== 'undefined';

  const release = useCallback(() => {
    runRef.current += 1;
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (meterRef.current) meterRef.current.style.width = '0%';
  }, []);

  const open = useCallback(
    async (deviceId: string) => {
      release();
      const run = runRef.current;
      setError(null);
      setHeard(false);
      setIsTesting(true);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
      } catch (caught) {
        if (run !== runRef.current) return;
        setError(errorText(caught));
        setIsTesting(false);
        return;
      }
      if (run !== runRef.current) {
        // Stopped or switched while the browser was asking: let this one go.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      onAccessRef.current?.();

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let level = 0;
      let frame = 0;
      let hasHeard = false;

      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : FLOOR_DB;
        const target = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
        // Rise at once, fall gently, so the bar doesn't flicker.
        level = target > level ? target : level * 0.9 + target * 0.1;
        if (meterRef.current) meterRef.current.style.width = `${(level * 100).toFixed(1)}%`;
        if (!hasHeard && level >= HEARD_LEVEL) {
          hasHeard = true;
          setHeard(true);
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      const track = stream.getAudioTracks()[0];
      const onEnded = () => {
        if (run !== runRef.current) return;
        release();
        setIsTesting(false);
        setError('The microphone stopped (it may have been unplugged).');
      };
      track?.addEventListener('ended', onEnded);

      cleanupRef.current = () => {
        cancelAnimationFrame(frame);
        track?.removeEventListener('ended', onEnded);
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
      };
    },
    [release],
  );

  const start = useCallback(() => {
    if (isSupported) void open(micId);
  }, [isSupported, micId, open]);

  const stop = useCallback(() => {
    release();
    setIsTesting(false);
    setHeard(false);
  }, [release]);

  // A different microphone picked mid-test: test that one instead.
  const isTestingRef = useRef(isTesting);
  isTestingRef.current = isTesting;
  useEffect(() => {
    if (isTestingRef.current) void open(micId);
  }, [micId, open]);

  useEffect(() => release, [release]);

  return { isSupported, isTesting, heard, error, start, stop, meterRef };
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Usage } from '@app/shared';
import { CrossIcon, LinkIcon, MicIcon, PhoneHangUpIcon } from '../../lib/icons';
import { ChatUsageLine } from './ChatUsageLine';
import type { ConversationState } from './conversation';
import { createSpeechSplitter, type SpokenSentence } from './speechText';
import type { ReplyStreamEvent } from './useConversation';
import { startRecognition, type HeardPhrase, type RecognitionHandle } from './useSpeechInput';
import { useSpeechOutput } from './useSpeechOutput';
import { useThinkingSound } from './useThinkingSound';
import { useVoicePrefs } from './voicePrefs';

/** idle: not talking; listening: hearing you; replying: the agent works and talks back. */
type Phase = 'idle' | 'listening' | 'replying';

type Tone = 'coral' | 'accent' | 'warn' | 'muted';

/** Said on its own right after interrupting, these send nothing: it just listens again. */
const JUST_STOP = /^(stop|wait|pause|enough|hold on|quiet|shh+)[.!]?$/i;
const joinPhrases = (phrases: HeardPhrase[]) => phrases.map((phrase) => phrase.text).join(' ');
/**
 * How long you can pause mid-message before it's sent. The browser's own end-of-speech
 * detection cuts in after well under a second, so recognition runs continuously and this
 * timer decides instead (restarted by every word heard).
 */
const SEND_AFTER_PAUSE_MS = 1000;
/** Nothing at all heard for this long: stop listening. */
const NO_SPEECH_MS = 8000;

const TONE_TEXT: Record<Tone, string> = {
  coral: 'text-coral',
  accent: 'text-accent-2',
  warn: 'text-warn',
  muted: 'text-ink-3',
};
const TONE_BAR: Record<Tone, string> = {
  coral: 'bg-coral',
  accent: 'bg-accent',
  warn: 'bg-warn',
  muted: 'bg-ink-4',
};

/**
 * Voice mode's stand-in for the message box: a live conversation. Tap once and talk; a
 * pause sends what you said, and the reply is read aloud as it streams (the sentence being
 * read shows in the bar); then it listens again, until End. The mic is only on while it's your turn (so the
 * speakers can't interrupt it); the Interrupt button cuts a reply short: it stops, hears you
 * out and answers that instead. Approvals still show in the chat and wait for a click.
 * A text box takes what's easier pasted than said (a link, a ticket number): it goes along
 * with the next thing you say, or Enter sends it on its own.
 */
export function VoiceBar(props: {
  disabled: boolean;
  hasModel: boolean;
  isRunning: boolean;
  isStopping: boolean;
  /** an approval card in the chat waits for a click */
  hasPendingApproval: boolean;
  /** the model pickers and Auto-approve, as in the message box */
  controls: ReactNode;
  /** This chat's tokens so far and the context window, shown under the bar like the message box. */
  usage: Usage;
  context: ConversationState['context'];
  onShowUsage?: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  subscribeReply: (listener: (event: ReplyStreamEvent) => void) => () => void;
  /**
   * How much of the reply's text the chat shows: up to the sentence being said, so the text
   * keeps pace with the voice; null shows it all (not replying, or cut short).
   */
  onSpokenUpTo: (end: number | null) => void;
}) {
  const {
    disabled,
    hasModel,
    isRunning,
    isStopping,
    hasPendingApproval,
    controls,
    usage,
    context,
    onShowUsage,
  } = props;
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState('');
  const [heard, setHeard] = useState('');
  const [caption, setCaption] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isQueued, setIsQueued] = useState(false);
  // Pasted or typed: sent with what's said next.
  const [note, setNote] = useState('');
  const noteRef = useRef('');
  const changeNote = (value: string) => {
    noteRef.current = value;
    setNote(value);
  };
  // The voice itself is chosen in the workspace settings (Voice tab).
  const { speak, cancel: cancelSpeech, hasQueue, isSpeaking } = useSpeechOutput();
  const [{ micId }] = useVoicePrefs();

  const phaseRef = useRef<Phase>('idle');
  const recognition = useRef<RecognitionHandle | null>(null);
  // Sends what was heard once you've paused long enough (see SEND_AFTER_PAUSE_MS).
  const pauseTimer = useRef<number | undefined>(undefined);
  const splitter = useRef(createSpeechSplitter());
  // Interrupted: the rest of that reply isn't read out.
  const isMuted = useRef(false);
  // The reply's leftover text has been read out (once per reply).
  const isReplyEnded = useRef(false);
  // Said while the interrupted reply was still stopping: sent once it has.
  const queued = useRef<string | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  // The flow, rebuilt each render so it sees current props; effects reach it through a ref.
  const flow = {
    go(next: Phase) {
      phaseRef.current = next;
      setPhase(next);
    },
    stopListening() {
      window.clearTimeout(pauseTimer.current);
      recognition.current?.abort();
      recognition.current = null;
    },
    /** Reads one sentence aloud; as it starts, it's the caption and shows in the chat. */
    say(sentence: SpokenSentence) {
      speak(sentence.text, () => {
        setCaption(sentence.text);
        latest.current.onSpokenUpTo(sentence.end);
      });
    },
    /** Stops the reply now: no more speech, and the run stops. */
    interrupt() {
      isMuted.current = true;
      cancelSpeech();
      setCaption(null);
      latest.current.onSpokenUpTo(null);
      if (latest.current.isRunning) latest.current.onStop();
    },
    startReply(text: string) {
      splitter.current.reset();
      latest.current.onSpokenUpTo(0);
      isMuted.current = false;
      isReplyEnded.current = false;
      latest.current.onSend(text);
    },
    /**
     * What you said, with the text box's note after it (or the note alone, typed and sent with
     * Enter): sent now, or once an interrupted reply has stopped.
     */
    submit(said: string, { isTyped = false }: { isTyped?: boolean } = {}) {
      setInterim('');
      if (!isTyped && JUST_STOP.test(said.trim())) {
        flow.listen();
        return;
      }
      const extra = isTyped ? '' : noteRef.current.trim();
      const text = extra ? `${said}\n\n${extra}` : said;
      changeNote('');
      setHeard(text);
      flow.go('replying');
      if (latest.current.isRunning) {
        queued.current = text;
        setIsQueued(true);
      } else flow.startReply(text);
    },
    /** Enter in the text box: send it now (cutting the reply short, like Interrupt). */
    sendNote() {
      const text = noteRef.current.trim();
      if (!text || (latest.current.disabled && !latest.current.isRunning)) return;
      setNotice(null);
      if (phaseRef.current === 'replying') flow.interrupt();
      flow.stopListening();
      flow.submit(text, { isTyped: true });
    },
    /** Hears one utterance; a pause sends it, silence ends the conversation. */
    listen() {
      flow.stopListening();
      setInterim('');
      setNotice(null);
      setCaption(null);
      latest.current.onSpokenUpTo(null);
      flow.go('listening');
      let text = '';
      let heardSoFar = '';
      // Ending the session reports any last words, then onEnd sends.
      const waitThenSend = (ms: number) => {
        window.clearTimeout(pauseTimer.current);
        pauseTimer.current = window.setTimeout(() => recognition.current?.stop(), ms);
      };
      const handle = startRecognition({
        continuous: true,
        micId,
        onHeard: (phrases) => {
          text = joinPhrases(phrases.filter((phrase) => phrase.isFinal));
          heardSoFar = joinPhrases(phrases);
          setInterim(heardSoFar);
          waitThenSend(SEND_AFTER_PAUSE_MS);
        },
        onEnd: () => {
          window.clearTimeout(pauseTimer.current);
          recognition.current = null;
          if (phaseRef.current !== 'listening') return;
          // Words not yet confirmed as final (ended early with Done) still count.
          const said = text || heardSoFar;
          if (said) flow.submit(said);
          else {
            flow.go('idle');
            setInterim('');
            setNotice((current) => current ?? "Didn't hear anything. Tap the mic to talk again.");
          }
        },
        onError: (message, code) => {
          if (code !== 'no-speech') setNotice(message);
        },
      });
      if (handle) {
        recognition.current = handle;
        waitThenSend(NO_SPEECH_MS);
      } else {
        flow.go('idle');
        setNotice("Voice input couldn't start. Try again.");
      }
    },
    end() {
      flow.go('idle');
      flow.stopListening();
      cancelSpeech();
      latest.current.onSpokenUpTo(null);
      queued.current = null;
      setIsQueued(false);
      setCaption(null);
      setInterim('');
    },
    /** The mic button: start talking, or finish speaking (sends what was heard so far). */
    press() {
      setNotice(null);
      if (phaseRef.current === 'idle') {
        cancelSpeech();
        flow.listen();
      } else if (phaseRef.current === 'listening') {
        recognition.current?.stop();
      }
    },
    /** The Interrupt button: cut the reply short and listen to you. */
    cutIn() {
      setNotice(null);
      flow.interrupt();
      flow.listen();
    },
  };
  const latestFlow = useRef(flow);
  useLayoutEffect(() => {
    latestFlow.current = flow;
  });

  // The reply, read aloud as it streams.
  const { subscribeReply } = props;
  useEffect(
    () =>
      subscribeReply((event) => {
        if (phaseRef.current !== 'replying' || isMuted.current || queued.current) return;
        const ready =
          event.type === 'text' ? splitter.current.push(event.text) : splitter.current.end();
        for (const sentence of ready) latestFlow.current.say(sentence);
      }),
    [subscribeReply],
  );

  // A reply finished: send what was said meanwhile, or read the rest out and listen again.
  useEffect(() => {
    if (phase !== 'replying' || isRunning) return;
    const current = latestFlow.current;
    const next = queued.current;
    if (next) {
      queued.current = null;
      setIsQueued(false);
      current.startReply(next);
      return;
    }
    if (!isReplyEnded.current) {
      isReplyEnded.current = true;
      if (!isMuted.current) for (const sentence of splitter.current.end()) current.say(sentence);
    }
    if (hasQueue()) return;
    if (disabled) current.end();
    else current.listen();
  }, [phase, isRunning, isSpeaking, hasQueue, disabled]);

  // An approval waits: say so once.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (hasPendingApproval && !wasWaiting.current && phaseRef.current === 'replying') {
      const line = 'I need your approval to continue. Check the screen.';
      speak(line, () => setCaption(line));
    }
    wasWaiting.current = hasPendingApproval;
  }, [hasPendingApproval, speak]);

  // Leaving the chat: stop listening (useSpeechOutput stops the voice).
  useEffect(
    () => () => {
      window.clearTimeout(pauseTimer.current);
      recognition.current?.abort();
    },
    [],
  );

  const isTalking = phase === 'replying' && isSpeaking;
  // Waiting on the agent (thinking, running tools): a soft pulse, so the silence isn't dead air.
  // Not while it waits on an approval click or is being stopped.
  useThinkingSound(
    phase === 'replying' && !isSpeaking && !hasPendingApproval && !isStopping && !isQueued,
  );
  const state: { label: string; tone: Tone } =
    phase === 'listening'
      ? { label: 'Listening', tone: 'coral' }
      : phase === 'replying'
        ? hasPendingApproval
          ? { label: 'Needs your approval', tone: 'warn' }
          : isStopping || isQueued
            ? { label: 'Stopping', tone: 'muted' }
            : isTalking
              ? { label: 'Speaking', tone: 'accent' }
              : { label: 'Thinking', tone: 'accent' }
        : { label: 'Voice chat', tone: 'muted' };
  const hint =
    phase === 'idle'
      ? !hasModel
        ? 'Add a model in Settings → Models first.'
        : disabled
          ? 'Wait for the agent to finish.'
          : 'Press Start and just talk.'
      : phase === 'listening'
        ? 'Pause for a second when you’re done.'
        : hasPendingApproval
          ? 'Approve or deny it in the chat.'
          : 'Press Interrupt to cut in.';
  const canStart = !disabled && hasModel;
  const isInCall = phase !== 'idle';

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
      <div
        // No overflow-hidden: the model and effort menus open upward out of this card.
        className={`mx-auto w-full max-w-[1000px] rounded-2xl border bg-surface shadow-card transition-colors ${
          isInCall ? 'border-line-strong' : 'border-line'
        }`}
      >
        <div
          className={`flex items-center gap-4 rounded-t-2xl px-4 py-3.5 transition-colors sm:px-5 ${
            phase === 'listening'
              ? 'bg-[linear-gradient(100deg,var(--coral-bg),var(--surface)_65%)]'
              : phase === 'replying'
                ? 'bg-[linear-gradient(100deg,var(--accent-soft),var(--surface)_65%)]'
                : ''
          }`}
        >
          {/* Who has the turn: the status, then what's being said. */}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 ${TONE_PILL[state.tone]}`}
              >
                <Waves tone={state.tone} isMoving={phase === 'listening' || isTalking} />
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.1em] ${TONE_TEXT[state.tone]}`}
                >
                  {state.label}
                </span>
              </span>
              {isInCall && <CallTimer />}
              <span className="hidden min-w-0 truncate text-[12px] text-ink-3 sm:inline">
                {hint}
              </span>
            </div>
            <p
              aria-live="polite"
              className="mt-2 line-clamp-2 min-h-[22px] text-[15px] leading-snug text-ink"
            >
              {phase === 'listening' ? (
                interim || <span className="text-ink-3">Go ahead, I’m listening…</span>
              ) : phase === 'replying' && caption ? (
                caption
              ) : phase === 'replying' && heard ? (
                <span className="text-ink-3">“{heard}”</span>
              ) : (
                <span className="text-ink-3">
                  {notice ?? 'Talk with the agent and hear its replies.'}
                </span>
              )}
            </p>
            {isInCall && notice && (
              <p role="alert" className="mt-0.5 text-[12px] text-warn">
                {notice}
              </p>
            )}
          </div>

          {/* Call controls: the turn's action, then End call, always last and always red. */}
          {isInCall ? (
            <div role="group" aria-label="Call controls" className="flex shrink-0 items-start gap-3">
              {phase === 'listening' ? (
                <CallButton
                  label="Send"
                  title="Done speaking: send what you said now"
                  tone="coral"
                  isPulsing
                  onClick={() => flow.press()}
                >
                  <MicIcon size={20} />
                </CallButton>
              ) : (
                <CallButton
                  label="Interrupt"
                  title="Stop the reply and talk"
                  tone="soft-coral"
                  disabled={isQueued}
                  onClick={() => flow.cutIn()}
                >
                  <HandIcon />
                </CallButton>
              )}
              <CallButton
                label="End call"
                title="End the voice chat"
                tone="danger"
                onClick={() => flow.end()}
              >
                <PhoneHangUpIcon size={22} />
              </CallButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => flow.press()}
              disabled={!canStart}
              title={canStart ? 'Start a voice chat' : hint}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-accent pl-3.5 pr-5 text-[13.5px] font-semibold text-on-accent shadow-accent outline-none transition-[background-color,transform,box-shadow] hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface enabled:hover:-translate-y-px active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20">
                <MicIcon size={16} />
              </span>
              <span>
                Start<span className="hidden sm:inline"> voice chat</span>
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line-2 px-4 py-2">
          <LinkIcon size={14} className={`shrink-0 ${note ? 'text-accent' : 'text-ink-3'}`} />
          <input
            value={note}
            onChange={(event) => changeNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                flow.sendNote();
              }
            }}
            disabled={!hasModel}
            aria-label="A link or note to send with what you say next"
            placeholder="Paste a link or type a note, then say what to do with it. Enter sends it now."
            className="min-w-0 flex-1 bg-transparent py-1 text-[13.5px] text-ink outline-none placeholder:text-ink-3"
          />
          {note && (
            <>
              <span className="hidden shrink-0 text-[11.5px] text-accent-2 sm:inline">
                Goes with what you say next
              </span>
              <button
                type="button"
                onClick={() => changeNote('')}
                aria-label="Clear the note"
                title="Clear"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
              >
                <CrossIcon size={10} />
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-3 py-1.5">
          {controls}
        </div>
      </div>
      <ChatUsageLine usage={usage} context={context} onShowUsage={onShowUsage} />
    </div>
  );
}

const TONE_PILL: Record<Tone, string> = {
  coral: 'bg-coral-bg',
  accent: 'bg-accent-soft',
  warn: 'bg-warn-bg',
  muted: 'bg-subtle',
};

const CALL_BUTTON_TONE = {
  coral: 'bg-coral text-on-accent hover:brightness-105 focus-visible:ring-coral',
  'soft-coral':
    'bg-coral-bg text-coral ring-1 ring-inset ring-coral hover:bg-coral hover:text-on-accent focus-visible:ring-coral',
  danger:
    'bg-danger-line text-white shadow-[0_6px_16px_-6px_var(--danger-line)] hover:brightness-110 focus-visible:ring-danger-line',
} as const;

/** A round call control with its name under it, like a phone's call screen. */
function CallButton({
  label,
  title,
  tone,
  isPulsing = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  title: string;
  tone: keyof typeof CALL_BUTTON_TONE;
  isPulsing?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex w-14 flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={title}
        className={`relative grid h-12 w-12 place-items-center rounded-full outline-none transition-[background-color,color,filter,transform] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface enabled:hover:-translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${CALL_BUTTON_TONE[tone]}`}
      >
        {isPulsing && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-coral opacity-35 motion-safe:animate-ping"
          />
        )}
        <span className="relative">{children}</span>
      </button>
      <span aria-hidden className="text-[11px] font-medium text-ink-3">
        {label}
      </span>
    </div>
  );
}

/** How long this voice chat has been going (mm:ss), from when it mounts. */
function CallTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <span className="shrink-0 text-[12px] tabular-nums text-ink-3" aria-label="Call length">
      {mm}:{ss}
    </span>
  );
}

/** A raised hand: cut in. */
function HandIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5.5 8V3.5a1 1 0 0 1 2 0V7.5M7.5 7V2.5a1 1 0 0 1 2 0V7.5M9.5 7.5V3.5a1 1 0 0 1 2 0V9.5c0 2.5-1.7 4.5-4.2 4.5-1.5 0-2.5-.7-3.3-1.9L2.6 9.8a1 1 0 0 1 1.6-1.2L5.5 10" />
    </svg>
  );
}

/** Four bars that move while someone is talking. */
function Waves({ tone, isMoving }: { tone: Tone; isMoving: boolean }) {
  return (
    <span aria-hidden className="flex h-3.5 shrink-0 items-center gap-[2px]">
      {[0, 1, 2, 3].map((bar) => (
        <span
          key={bar}
          style={{ animationDelay: `${bar * 120}ms` }}
          className={`h-full w-[3px] origin-center rounded-full ${TONE_BAR[tone]} ${
            isMoving ? 'motion-safe:animate-voice-wave' : 'scale-y-[0.35]'
          }`}
        />
      ))}
    </span>
  );
}

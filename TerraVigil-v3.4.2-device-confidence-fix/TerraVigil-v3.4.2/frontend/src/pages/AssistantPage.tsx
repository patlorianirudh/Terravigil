import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Database,
  FileText,
  MessageSquarePlus,
  Mic,
  MicOff,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { api } from '../services/api';
import { config } from '../config';
import { useSessionStore } from '../state/sessionStore';
import { fmtTime } from '../lib/formatters';
import type { AssistantMessage, CitationSource, MissionPreparation } from '../domain/types';
import '../styles/workspace.css';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const PROMPTS = [
  {
    icon: Database,
    title: 'Summarize the session',
    detail: 'Bring the latest observations together',
    query:
      'Summarize the observations recorded in the selected session. Separate confirmed detections from single-sensor observations.',
  },
  {
    icon: BookOpen,
    title: 'Understand the evidence',
    detail: 'Explore the dual-sensor workflow',
    query: 'How does the visual and metallic evidence confirmation workflow work? Cite the source.',
  },
  {
    icon: ShieldCheck,
    title: 'Interpret a risk band',
    detail: 'Find the basis for a classification',
    query:
      'What do the high, medium and low risk bands represent, and what are their limitations? Cite the source.',
  },
  {
    icon: FileText,
    title: 'Consult project references',
    detail: 'Ask a question with source references',
    query:
      'Explain how survey coverage differs from land release, citing available project requirements and their limitations.',
  },
];

export const AssistantPage: React.FC = () => {
  const sessionId = useSessionStore((state) => state.activeSession?.id);
  return <MissionConversation key={sessionId ?? 'none'} />;
};

const MissionConversation: React.FC = () => {
  const activeSession = useSessionStore((s) => s.activeSession);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparation, setPreparation] = useState<MissionPreparation | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [listening, setListening] = useState(false);
  const [citation, setCitation] = useState<CitationSource | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const preparationRef = useRef<Promise<MissionPreparation> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef(false);
  const voiceSupported = speechRecognitionCtor() !== null;
  const sourceCount = messages.reduce((sum, m) => sum + (m.citations?.length ?? 0), 0);

  const prepare = useCallback(
    async (missionId: string, force = false): Promise<MissionPreparation> => {
      if (!force && preparation?.sessionId === missionId) return preparation;
      if (preparationRef.current !== null) return preparationRef.current;
      if (force) setPreparation(null);
      setIsPreparing(true);
      setFailure(null);
      const pending = api
        .prepareMission(missionId)
        .then((result) => {
          if (useSessionStore.getState().activeSession?.id === missionId) setPreparation(result);
          return result;
        })
        .catch((cause: unknown) => {
          if (useSessionStore.getState().activeSession?.id === missionId)
            setFailure(cause instanceof Error ? cause.message : 'Mission preparation failed.');
          throw cause;
        })
        .finally(() => {
          preparationRef.current = null;
          setIsPreparing(false);
        });
      preparationRef.current = pending;
      return pending;
    },
    [preparation],
  );
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);
  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  const send = useCallback(
    async (text: string, retry = false): Promise<void> => {
      const query = text.trim();
      if (sendingRef.current) return;
      if (!activeSession?.id || query === '' || query.length > 1000) {
        setFailure('Select a mission and enter a question between 1 and 1,000 characters.');
        return;
      }
      const missionId = activeSession.id;
      sendingRef.current = true;
      if (!retry)
        setMessages((previous) => [
          ...previous,
          {
            id: `local-${String(Date.now())}`,
            sender: 'user',
            timestamp: new Date().toISOString(),
            text: query,
          },
        ]);
      setInput('');
      setLastQuery(query);
      setIsSending(true);
      setFailure(null);
      try {
        if (preparation?.sessionId !== missionId) await prepare(missionId);
        if (useSessionStore.getState().activeSession?.id !== missionId) return;
        const reply = await api.queryAssistant(query, missionId);
        if (useSessionStore.getState().activeSession?.id === missionId)
          setMessages((previous) => [...previous, reply]);
      } catch (cause) {
        if (useSessionStore.getState().activeSession?.id === missionId)
          setFailure(cause instanceof Error ? cause.message : 'The assistant did not respond.');
      } finally {
        sendingRef.current = false;
        setIsSending(false);
      }
    },
    [activeSession, preparation, prepare],
  );

  const toggleVoice = (): void => {
    const Ctor = speechRecognitionCtor();
    if (Ctor === null) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      setInput(event.results[0][0].transcript);
      inputRef.current?.focus();
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setFailure(
        event.error === 'not-allowed'
          ? 'Microphone access is unavailable. You can type your question below.'
          : 'Dictation stopped. Try again or type your question.',
      );
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setFailure('Dictation could not start. You can type your question below.');
    }
  };

  return (
    <div className="assistant-page">
      <header className="assistant-header">
        <div className="flex items-center gap-3">
          <span className="workspace-icon-box">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h1>Mission assistant</h1>
            <p>
              {config.dataMode === 'demo'
                ? 'Offline preview · deterministic summaries. No AI model is running.'
                : activeSession?.isSample
                  ? 'Synthetic mission records · real indexing and AI generation when configured.'
                  : 'Grounded answers. Traceable evidence.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={preparation !== null ? 'secondary' : 'primary'}
            disabled={!activeSession || isPreparing || isSending}
            onClick={() => {
              if (activeSession) void prepare(activeSession.id, true).catch(() => undefined);
            }}
          >
            {isPreparing
              ? 'Preparing mission data…'
              : preparation !== null
                ? config.dataMode === 'demo'
                  ? 'Offline sample ready'
                  : `Mission data ready · ${String(preparation.indexedChunks)} chunks`
                : 'Prepare mission data'}
          </Button>
          <Button
            icon={<MessageSquarePlus className="size-4" />}
            disabled={isSending || isPreparing || messages.length === 0}
            onClick={() => {
              setMessages([]);
              setCitation(null);
              setInput('');
              setFailure(null);
              inputRef.current?.focus();
            }}
          >
            New conversation
          </Button>
        </div>
      </header>
      <div className="assistant-layout">
        <div className="assistant-main">
          <div className="assistant-conversation">
            {messages.length === 0 ? (
              <div className="assistant-welcome">
                <div className="assistant-emblem" aria-hidden>
                  <Sparkles className="size-7" strokeWidth={1.5} />
                </div>
                <p className="workspace-kicker text-accent">Your field intelligence companion</p>
                <h2>
                  Make sense of
                  <br />
                  <span>what you’re seeing.</span>
                </h2>
                <p className="assistant-welcome-copy">
                  Explore survey records, understand sensor evidence, and inspect the sources behind
                  a decision.
                </p>
                <div className="assistant-prompts">
                  {PROMPTS.map((prompt) => (
                    <button
                      type="button"
                      key={prompt.title}
                      onClick={() => {
                        setInput(prompt.query);
                        inputRef.current?.focus();
                      }}
                    >
                      <prompt.icon className="size-4 text-accent" />
                      <strong>{prompt.title}</strong>
                      <span>{prompt.detail}</span>
                      <ArrowUpRight className="assistant-prompt-arrow size-4" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="assistant-messages" aria-live="polite" aria-relevant="additions text">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`assistant-message ${message.sender === 'user' ? 'assistant-message-user' : ''}`}
                  >
                    <div className="assistant-message-meta">
                      <span className="assistant-avatar">
                        {message.sender === 'user' ? 'You' : <Sparkles className="size-3.5" />}
                      </span>
                      <strong>{message.sender === 'user' ? 'You' : 'TerraVigil assistant'}</strong>
                      <time dateTime={message.timestamp}>{fmtTime(message.timestamp)}</time>
                    </div>
                    <div
                      className={`assistant-message-body ${message.refused === true ? 'assistant-message-refused' : ''}`}
                    >
                      <p>{message.text}</p>
                      {message.sqlQuery !== undefined && (
                        <details className="assistant-query">
                          <summary>
                            <Database className="size-3.5" /> Query used for this answer
                          </summary>
                          <pre>{message.sqlQuery}</pre>
                        </details>
                      )}
                      {message.citations !== undefined && message.citations.length > 0 && (
                        <div className="assistant-message-sources">
                          <span>Sources</span>
                          {message.citations.map((source, index) => (
                            <button
                              type="button"
                              key={`${message.id}-${String(index)}`}
                              onClick={() => {
                                setCitation(source);
                              }}
                            >
                              <BookOpen className="size-3.5" />
                              {index + 1}. {source.document}
                              <ChevronRight className="size-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {isSending && (
              <div className="assistant-thinking" role="status">
                <Sparkles className="size-4" />
                <span>
                  {isPreparing
                    ? 'Preparing the selected mission'
                    : 'Consulting the available evidence'}
                </span>
                <i />
                <i />
                <i />
              </div>
            )}
            {failure !== null && (
              <div role="alert" className="assistant-failure">
                <p>{failure}</p>
                {lastQuery !== '' && (
                  <Button
                    size="sm"
                    onClick={() => {
                      void send(lastQuery, true);
                    }}
                    disabled={isSending}
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="assistant-compose-wrap">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
              className="assistant-compose"
            >
              <label htmlFor="assistant-question" className="sr-only">
                Question for the mission assistant
              </label>
              <textarea
                id="assistant-question"
                ref={inputRef}
                rows={2}
                maxLength={1000}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={
                  listening
                    ? 'Listening to your question…'
                    : 'Ask about this session, evidence, or project references…'
                }
              />
              <div className="assistant-compose-tools">
                <span>
                  <Radio className="size-3.5" />
                  {activeSession?.siteName ?? 'No session selected'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleVoice}
                    disabled={!voiceSupported || isSending}
                    aria-label={listening ? 'Stop dictation' : 'Dictate question'}
                    aria-pressed={listening}
                    title={
                      voiceSupported
                        ? 'Dictate a question'
                        : 'Speech recognition unavailable in this browser'
                    }
                    className={`assistant-voice ${listening ? 'text-critical' : ''}`}
                  >
                    {listening ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSending ||
                      !activeSession ||
                      input.trim() === '' ||
                      input.trim().length > 1000
                    }
                    aria-label="Send question"
                    className="assistant-send"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                </div>
              </div>
            </form>
            <p className="assistant-compose-note">
              Decision support only. Verify cited sources. No answer authorizes entry or certifies
              land release.
            </p>
          </div>
        </div>
        <aside className="assistant-context" aria-label="Conversation context and sources">
          <div className="assistant-context-heading">
            <BookOpen className="size-4" />
            <h2>Source context</h2>
            <span>{sourceCount}</span>
          </div>
          {citation !== null ? (
            <div className="assistant-citation">
              <div className="flex items-center justify-between gap-2">
                <span className="workspace-kicker text-accent">Selected reference</span>
                <button
                  type="button"
                  aria-label="Close reference"
                  className="workspace-icon-link"
                  onClick={() => {
                    setCitation(null);
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
              <FileText className="mt-6 size-7 text-text-secondary" />
              <h3>{citation.document}</h3>
              <p>
                {citation.section}
                {citation.page !== undefined && ` · Page ${citation.page}`}
                {citation.version !== undefined && ` · ${citation.version}`}
              </p>
              <p>
                {citation.sessionId && `Mission ${citation.sessionId}`}
                {citation.sourceType && ` · ${citation.sourceType}`}
                {citation.sourceId && ` · ${citation.sourceId}`}
              </p>
              {citation.sourceRecordId && <p>Record {citation.sourceRecordId}</p>}
              {citation.similarity != null && <p>Similarity score: {citation.similarity}</p>}
              <blockquote>{citation.snippet}</blockquote>
              <span className="assistant-source-label">
                <Check className="size-3.5" />
                Source passage supplied with the answer
              </span>
            </div>
          ) : (
            <div className="assistant-context-empty">
              <div className="assistant-reference-icon">
                <FileText className="size-6" strokeWidth={1.5} />
              </div>
              <h3>Evidence, one click away.</h3>
              <p>
                Select a source in an answer to inspect the original passage, document, and section.
              </p>
              <div className="assistant-context-rule" />
              <span className="workspace-kicker">Available context</span>
              <div className="assistant-context-item">
                <Database className="size-4" />
                <div>
                  <strong>Session register</strong>
                  <p>{activeSession?.siteName ?? 'Select a session to scope questions'}</p>
                </div>
              </div>
              <div className="assistant-context-item">
                <Check className="size-4" />
                <div>
                  <strong>Mission index</strong>
                  <p>
                    {preparation === null
                      ? 'Prepared automatically before the first question'
                      : config.dataMode === 'demo'
                        ? 'Offline preview; no embedding model is running'
                        : `${String(preparation.indexedChunks)} chunks · ${preparation.model}`}
                  </p>
                </div>
              </div>
              <div className="assistant-context-item">
                <BookOpen className="size-4" />
                <div>
                  <strong>Project references</strong>
                  <p>
                    Project requirements are labeled separately from mission evidence; they are not
                    clearance doctrine.
                  </p>
                </div>
              </div>
              <div className="assistant-context-item">
                <ShieldCheck className="size-4" />
                <div>
                  <strong>Human judgment</strong>
                  <p>The operator retains decision authority</p>
                </div>
              </div>
            </div>
          )}
          <div className="assistant-scope-note">
            <ShieldCheck className="size-4" />
            <p>
              The assistant explains evidence. It does not change risk scores or operate the
              aircraft.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

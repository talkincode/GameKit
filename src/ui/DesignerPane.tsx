import { useEffect, useRef, useState } from "react";
import { designLines, type DesignCard } from "../lib/design";
import { MAX_ATTACHMENTS, imagesFrom, prepareImage, type PreparedImage } from "../lib/images";
import { listen, voiceSupported, type VoiceSession } from "../lib/speech";
import { useStudio, type Turn } from "../studio/store";
import { AgentWorking } from "./AgentWorking";
import { text } from "./text";

/**
 * The conversation pane: one card per round, newest at the bottom. It records
 * what the agent did; only 采用 changes the child's project.
 */
export function DesignerPane() {
  const studio = useStudio();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const ready = (draft.trim().length > 0 || images.length > 0) && studio.canTurn;

  const send = () => {
    if (!ready) return;
    const request = draft.trim() || text.pane.imageOnly;
    setDraft("");
    const attached = images;
    setImages([]);
    void studio.startTurn(
      request,
      attached.map((image) => ({ dataUrl: image.dataUrl })),
    );
  };

  return (
    <section className="pane" data-testid="pane">
      <header className="pane-head">
        <strong>{text.pane.title}</strong>
      </header>
      <div className="pane-scroll">
        {!studio.turns.length ? <Welcome design={studio.project?.design} /> : null}
        {studio.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
      </div>
      <div className="pane-bottom">
        {/* The same live status as the header chip, right where the child is looking. */}
        <AgentWorking where="pane" />
        <Ask
          draft={draft}
          setDraft={setDraft}
          send={send}
          ready={ready}
          images={images}
          setImages={setImages}
        />
      </div>
    </section>
  );
}

function Welcome({ design }: { design?: DesignCard }) {
  const lines = design ? designLines(design) : [];
  return (
    <div className="welcome">
      <h2>{text.pane.welcome}</h2>
      <p>{text.pane.examples}</p>
      {lines.length ? (
        <article className="card design" data-testid="current-design">
          <h3>
            {text.pane.current}
            {design?.title ? ` · ${design.title}` : ""}
          </h3>
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ) : null}
      <p className="quiet">{text.pane.hintPlay}</p>
    </div>
  );
}

function Ask({
  draft,
  setDraft,
  send,
  ready,
  images,
  setImages,
}: {
  draft: string;
  setDraft: (value: string) => void;
  send: () => void;
  ready: boolean;
  images: PreparedImage[];
  setImages: (images: PreparedImage[]) => void;
}) {
  const studio = useStudio();
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const [listening, setListening] = useState(false);
  const [guess, setGuess] = useState("");
  const [voiceNote, setVoiceNote] = useState("");
  const [dropping, setDropping] = useState(false);

  // Grow with the text, up to a few lines, then scroll.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft, guess]);

  useEffect(() => () => session.current?.stop(), []);

  const addImages = async (files: File[]) => {
    const room = MAX_ATTACHMENTS - images.length;
    if (room <= 0 || !files.length) return;
    try {
      const prepared = await Promise.all(files.slice(0, room).map((file) => prepareImage(file)));
      setImages([...images, ...prepared]);
      setVoiceNote("");
    } catch {
      setVoiceNote(text.pane.imageFailed);
    }
  };

  const stopListening = () => {
    session.current?.stop();
    session.current = null;
    setListening(false);
    setGuess("");
  };

  const toggleListening = () => {
    if (listening) {
      stopListening();
      return;
    }
    setVoiceNote("");
    session.current = listen({
      onText: (text, final) => {
        if (final) setDraft(`${draft ? `${draft} ` : ""}${text.trim()}`);
        else setGuess(text.trim());
      },
      onError: (reason) => {
        setVoiceNote(
          reason === "denied" ? text.pane.voiceDenied : reason === "unsupported" ? text.pane.voiceUnsupported : text.pane.voiceFailed,
        );
        setListening(false);
        setGuess("");
      },
      onEnd: () => {
        setListening(false);
        setGuess("");
      },
    });
    if (session.current) setListening(true);
  };

  if (studio.account.kind === "checking") return <div className="pane-locked">{text.account.checking}</div>;
  if (studio.account.kind !== "signed-in") {
    return (
      <div className="pane-locked">
        <p>{text.ai.needsSignIn}</p>
        <button className="run" type="button" onClick={studio.signIn}>
          {text.ai.signInToUse}
        </button>
      </div>
    );
  }
  return (
    <form
      className={dropping ? "pane-ask dropping" : "pane-ask"}
      data-testid="ask"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        void addImages(imagesFrom(event.dataTransfer.files));
      }}
    >
      {images.length ? (
        <ul className="attachments" data-testid="attachments">
          {images.map((image, index) => (
            <li key={`${image.dataUrl.slice(-24)}-${index}`}>
              <img src={image.dataUrl} alt={text.pane.attached(index + 1)} />
              <button
                type="button"
                aria-label={text.pane.removeImage}
                onClick={() => setImages(images.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={box}
        value={draft}
        rows={2}
        aria-label={text.pane.placeholder}
        placeholder={studio.turns.length ? text.pane.placeholderNext : text.pane.placeholder}
        title={text.pane.attachHint}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const files = imagesFrom(event.clipboardData?.files);
          if (!files.length) return;
          event.preventDefault();
          void addImages(files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      {listening ? (
        <p className="ask-listening" data-testid="listening">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {guess ? `${text.pane.listening}${guess}` : text.pane.listening}
        </p>
      ) : null}
      {voiceNote ? <p className="ask-note">{voiceNote}</p> : null}
      <div className="pane-actions">
        <input
          ref={picker}
          className="visually-hidden"
          type="file"
          accept="image/*"
          multiple
          data-testid="image-input"
          onChange={(event) => {
            void addImages(imagesFrom(event.target.files));
            event.target.value = "";
          }}
        />
        <button
          className="attach"
          type="button"
          title={text.pane.attachHint}
          aria-label={text.pane.attachLabel}
          onClick={() => picker.current?.click()}
        >
          <IconPicture />
        </button>
        {voiceSupported() ? (
          <button
            className={listening ? "mic on" : "mic"}
            type="button"
            data-testid="mic"
            aria-label={text.pane.voiceLabel}
            aria-pressed={listening}
            title={text.pane.voice}
            onClick={toggleListening}
          >
            <IconMic />
            <span>{listening ? text.pane.listening : text.pane.voice}</span>
          </button>
        ) : null}
        <button className="run" type="submit" disabled={!ready}>
          {studio.turns.length ? text.pane.sendNext : text.pane.send}
        </button>
        {studio.turnBusy ? (
          <button className="ghost" type="button" onClick={studio.cancelTurn}>
            {text.pane.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function IconPicture() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M2.5 10.5l3.2-3 2.6 2.4 2-1.8 3.2 2.9" />
      <circle cx="6" cy="6" r="1" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5a1.8 1.8 0 0 1 1.8 1.8v3.4a1.8 1.8 0 0 1-3.6 0V4.3A1.8 1.8 0 0 1 8 2.5Z" />
      <path d="M4.2 7.4v.6a3.8 3.8 0 0 0 7.6 0v-.6M8 11.8v1.7" />
    </svg>
  );
}

function mark(status: Turn["steps"][number]["status"]): string {
  if (status === "done") return "✓";
  if (status === "failed") return "×";
  return "•";
}

function TurnCard({ turn }: { turn: Turn }) {
  return turn.kind === "explain" ? <ExplainTurn turn={turn} /> : <DesignTurn turn={turn} />;
}

function ExplainTurn({ turn }: { turn: Turn }) {
  return (
    <article className="turn explain" data-testid="explain-turn">
      <p className="said">
        <em>{text.pane.youSaid}</em>
        {turn.request}
      </p>
      <p className="answer">{turn.answer ?? text.pane.explainBusy}</p>
    </article>
  );
}

function DesignTurn({ turn }: { turn: Turn }) {
  const studio = useStudio();
  const outcome = turn.outcome;
  const showCandidate = !!turn.candidate && !turn.adopted && !turn.discarded;
  const canAdopt = showCandidate && outcome?.kind === "ready";
  return (
    <article className={`turn design ${outcome?.kind ?? "running"}`} data-testid="design-turn">
      <p className="said">
        <em>{text.pane.youSaid}</em>
        {turn.request}
      </p>
      {turn.images?.length ? (
        <ul className="attachments said-images">
          {turn.images.map((image, index) => (
            <li key={`${image.slice(-24)}-${index}`}>
              <img src={image} alt={text.pane.attached(index + 1)} />
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="steps">
        {turn.steps.map((step) => (
          <li key={step.key} className={`step ${step.status}`}>
            <span className="mark" aria-hidden="true">
              {mark(step.status)}
            </span>
            <span className="label">{text.steps[step.kind]}</span>
            <span className="quiet">{step.detail ? step.detail.slice(0, 120) : ""}</span>
          </li>
        ))}
      </ol>
      {turn.design ? (
        <article className="card design" data-testid="turn-design">
          <h3>{turn.design.title || text.pane.candidateTitle}</h3>
          <ul>
            {designLines(turn.design).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {turn.say ? <p className="say">{turn.say}</p> : null}
        </article>
      ) : null}
      {showCandidate && turn.candidate ? (
        <div className="candidate" data-testid="candidate">
          <p className="quiet">{text.pane.changed(turn.candidate.diff.length)}</p>
          {turn.candidate.diff.length ? (
            <details className="diff-view">
              <summary>{text.pane.showDiff}</summary>
              {turn.candidate.diff.map((file) => (
                <article key={file.path}>
                  <h4>{file.path}</h4>
                  <pre>
                    {file.rows.map((row, index) => (
                      <span key={`${file.path}-${index}`} className={`diff-${row.kind}`}>
                        {row.kind === "add" ? "+ " : row.kind === "del" ? "- " : "  "}
                        {row.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </article>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
      {turn.adopted ? <p className="turn-foot good">{text.pane.adopted}</p> : null}
      {turn.discarded ? <p className="turn-foot">{text.pane.discarded}</p> : null}
      {!turn.adopted && !turn.discarded && outcome && outcomeCopy(turn) ? (
        <p className={`turn-foot ${outcome.kind}`}>{outcomeCopy(turn)}</p>
      ) : null}
      {canAdopt ? (
        <div className="turn-actions">
          <button
            className="run"
            type="button"
            data-testid="adopt"
            disabled={!studio.project || turn.candidate?.project.id !== studio.project.id}
            onClick={studio.adoptCandidate}
          >
            {text.pane.adopt}
          </button>
          <button className="ghost" type="button" data-testid="discard" onClick={studio.discardCandidate}>
            {text.pane.discard}
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** One kid-facing sentence for how the round ended. */
function outcomeCopy(turn: Turn): string {
  const outcome = turn.outcome;
  if (!outcome) return "";
  if (outcome.kind === "cancelled") return text.pane.cancelled;
  if (outcome.kind === "blocked") return text.pane.blocked;
  if (outcome.kind === "failed") return text.pane.failed;
  if (outcome.unverified) return text.pane.unverified;
  return "";
}

/**
 * Voice input for the ask box.
 *
 * The Web Speech API is wrapped here so no component touches vendor prefixes, and
 * a browser without it simply never shows a microphone. `onText` reports the
 * final phrase to append; `interim` is the live, still-changing guess.
 */
type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [index: number]: Alternative };
type ResultList = { length: number; [index: number]: Result };
type RecognitionEvent = { resultIndex: number; results: ResultList };

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return recognitionCtor() !== null;
}

export type VoiceSession = { stop: () => void };

export type VoiceFailure = "unsupported" | "denied" | "failed";

export function listen(input: {
  lang?: string;
  onText: (text: string, final: boolean) => void;
  onError: (reason: VoiceFailure) => void;
  onEnd: () => void;
}): VoiceSession | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    input.onError("unsupported");
    return null;
  }
  const recognition = new Ctor();
  recognition.lang = input.lang ?? "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    let settled = "";
    let guess = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript ?? "";
      if (result?.isFinal) settled += text;
      else guess += text;
    }
    if (settled) input.onText(settled, true);
    if (guess) input.onText(guess, false);
  };
  recognition.onerror = (event) => {
    const blocked = event.error === "not-allowed" || event.error === "service-not-allowed";
    input.onError(blocked ? "denied" : "failed");
  };
  recognition.onend = () => input.onEnd();
  try {
    recognition.start();
  } catch {
    input.onError("failed");
    return null;
  }
  return { stop: () => recognition.stop() };
}

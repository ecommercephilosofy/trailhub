/**
 * Voice-note transcription.
 *
 * Two implementations behind one port:
 *
 *  - {@link OpenAIWhisperProvider} — the configured path, plain `fetch`,
 *    multipart upload, bounded retries on 429/5xx only.
 *  - {@link LocalTranscriptionProvider} — the no-credentials path. It does
 *    **not** invent a transcript. It returns `status: 'NOT_CONFIGURED'` with a
 *    Catalan explanation of exactly which variables to set, so the UI can show
 *    a configuration notice instead of a fake result — and it accepts a
 *    manually pasted transcript as a first-class input, so the whole
 *    interpretation → confirmation flow still works with no API key at all.
 */
import {
  DEFAULT_RETRY,
  parseRetryAfter,
  readBodySafely,
  requestWithRetry,
  systemClock,
  type Clock,
  type FetchLike,
  type RetryDecision,
  type RetryPolicy,
} from '../util/http';
import { createSecretScrubber, redact } from '../util/redact';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Matches the `audio_format` values the app accepts on upload. */
export const SUPPORTED_AUDIO_FORMATS = ['m4a', 'mp3', 'wav', 'webm'] as const;
export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export const AUDIO_MIME_TYPES: Record<AudioFormat, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

/** 25 MB — the provider's own ceiling; anything larger must be split. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** 30 minutes. A commercial note is a minute; half an hour is a mistake. */
export const MAX_AUDIO_SECONDS = 30 * 60;

export interface AudioInput {
  readonly kind: 'audio';
  readonly data: Uint8Array;
  readonly format: string;
  readonly filename?: string;
  readonly durationSeconds?: number;
  /** ISO-639-1 hint, e.g. `ca`. */
  readonly language?: string;
}

/** A transcript typed or pasted by the user. Always accepted. */
export interface ManualTranscriptInput {
  readonly kind: 'manual';
  readonly transcript: string;
  readonly language?: string;
}

export type TranscriptionInput = AudioInput | ManualTranscriptInput;

export type TranscriptionResult =
  | {
      readonly status: 'OK';
      readonly transcript: string;
      readonly provider: string;
      readonly model?: string;
      readonly language?: string;
      readonly durationSeconds?: number;
    }
  | {
      readonly status: 'NOT_CONFIGURED';
      readonly provider: string;
      /** Catalan explanation for the UI. */
      readonly message: string;
      readonly missing: readonly string[];
    };

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TranscriptionError extends Error {
  override readonly name: string = 'TranscriptionError';
}

export class UnsupportedAudioFormatError extends TranscriptionError {
  override readonly name = 'UnsupportedAudioFormatError';
  readonly format: string;

  constructor(format: string) {
    super(
      `Format d'àudio no admès: «${format}». Formats acceptats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}.`,
    );
    this.format = format;
  }
}

export class AudioTooLargeError extends TranscriptionError {
  override readonly name = 'AudioTooLargeError';
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `L'àudio ocupa ${(bytes / 1024 / 1024).toFixed(1)} MB i el màxim és ${
        MAX_AUDIO_BYTES / 1024 / 1024
      } MB. Cal dividir la nota en fragments més curts.`,
    );
    this.bytes = bytes;
  }
}

export class AudioTooLongError extends TranscriptionError {
  override readonly name = 'AudioTooLongError';
  readonly durationSeconds: number;

  constructor(durationSeconds: number) {
    super(
      `L'àudio dura ${Math.round(durationSeconds)} s i el màxim és ${MAX_AUDIO_SECONDS} s.`,
    );
    this.durationSeconds = durationSeconds;
  }
}

export class EmptyAudioError extends TranscriptionError {
  override readonly name = 'EmptyAudioError';

  constructor() {
    super("L'àudio està buit.");
  }
}

export class EmptyTranscriptError extends TranscriptionError {
  override readonly name = 'EmptyTranscriptError';

  constructor() {
    super('La transcripció està buida.');
  }
}

export class TranscriptionRequestError extends TranscriptionError {
  override readonly name = 'TranscriptionRequestError';
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isSupportedAudioFormat(format: string): format is AudioFormat {
  return (SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(normaliseFormat(format));
}

function normaliseFormat(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, '').replace(/^audio\//, '');
}

/** Throws a typed error rather than letting a bad upload reach the network. */
export function validateAudioInput(input: AudioInput): AudioFormat {
  const format = normaliseFormat(input.format);
  if (!isSupportedAudioFormat(format)) throw new UnsupportedAudioFormatError(input.format);
  if (input.data.byteLength === 0) throw new EmptyAudioError();
  if (input.data.byteLength > MAX_AUDIO_BYTES) throw new AudioTooLargeError(input.data.byteLength);
  if (input.durationSeconds !== undefined) {
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
      throw new TranscriptionError("La durada de l'àudio no és vàlida.");
    }
    if (input.durationSeconds > MAX_AUDIO_SECONDS) throw new AudioTooLongError(input.durationSeconds);
  }
  return format;
}

// ---------------------------------------------------------------------------
// Local provider — the no-credentials path
// ---------------------------------------------------------------------------

export const TRANSCRIPTION_NOT_CONFIGURED_MESSAGE =
  "La transcripció automàtica no està configurada. Pots enganxar la transcripció a mà i continuar amb tot el procés " +
  "(interpretació, revisió i confirmació) amb normalitat. Per activar-la, defineix TRANSCRIPTION_PROVIDER=openai i " +
  'OPENAI_API_KEY a les variables d’entorn (opcionalment TRANSCRIPTION_MODEL, per defecte «whisper-1»).';

export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'local';

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (input.kind === 'manual') {
      const transcript = input.transcript.trim();
      if (transcript.length === 0) throw new EmptyTranscriptError();
      return {
        status: 'OK',
        transcript,
        provider: this.name,
        ...(input.language === undefined ? {} : { language: input.language }),
      };
    }

    // Validate anyway: the user should learn the file is unusable now, not
    // after they have configured a provider.
    validateAudioInput(input);

    return {
      status: 'NOT_CONFIGURED',
      provider: this.name,
      message: TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
      missing: ['TRANSCRIPTION_PROVIDER', 'OPENAI_API_KEY'],
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI Whisper provider
// ---------------------------------------------------------------------------

export interface OpenAIWhisperOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly retry?: RetryPolicy;
  /** Default language hint. */
  readonly language?: string;
}

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
export const OPENAI_API_BASE = 'https://api.openai.com/v1';

export class OpenAIWhisperProvider implements TranscriptionProvider {
  readonly name = 'openai';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly language: string | undefined;
  private readonly scrub: (text: string) => string;

  constructor(options: OpenAIWhisperOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new TranscriptionError(
        "Falta OPENAI_API_KEY: no es pot crear el proveïdor de transcripció d'OpenAI.",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_TRANSCRIPTION_MODEL;
    this.baseUrl = (options.baseUrl ?? OPENAI_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.clock = options.clock ?? systemClock;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.language = options.language;
    this.scrub = createSecretScrubber(this.apiKey);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    // A pasted transcript never needs the network, whatever the provider is.
    if (input.kind === 'manual') {
      const transcript = input.transcript.trim();
      if (transcript.length === 0) throw new EmptyTranscriptError();
      return {
        status: 'OK',
        transcript,
        provider: this.name,
        ...(input.language === undefined ? {} : { language: input.language }),
      };
    }

    const format = validateAudioInput(input);
    const language = input.language ?? this.language;

    const send = (): Promise<Response> => {
      const form = new FormData();
      // A fresh Blob per attempt: a consumed body cannot be retried.
      const blob = new Blob([input.data as unknown as BlobPart], { type: AUDIO_MIME_TYPES[format] });
      form.append('file', blob, input.filename ?? `nota-de-veu.${format}`);
      form.append('model', this.model);
      form.append('response_format', 'json');
      // Deterministic decoding: this is dictation, not creative writing.
      form.append('temperature', '0');
      if (language) form.append('language', language);
      return this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        // No content-type header: fetch sets the multipart boundary itself.
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    };

    const classify = async (response: Response): Promise<RetryDecision> => {
      if (response.ok) return { kind: 'return' };
      // Only congestion and server faults are retried; a 400 will never
      // succeed on a second identical upload.
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = parseRetryAfter(response);
        return retryAfter === undefined
          ? { kind: 'retry' }
          : { kind: 'retry', retryAfterSeconds: retryAfter };
      }
      const body = await readBodySafely(response);
      return {
        kind: 'fail',
        error: new TranscriptionRequestError(
          `El servei de transcripció ha retornat un error ${response.status}: ${this.scrub(
            String(redact(summarise(body))),
          )}`,
          response.status,
        ),
      };
    };

    const response = await requestWithRetry(
      { fetch: this.fetchImpl, clock: this.clock, retry: this.retry },
      send,
      classify,
    );

    const text = await readBodySafely(response, 1_000_000);
    let payload: { text?: string; language?: string; duration?: number } = {};
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new TranscriptionRequestError(
        'El servei de transcripció ha retornat una resposta que no és JSON vàlid.',
        response.status,
      );
    }

    const transcript = (payload.text ?? '').trim();
    if (transcript.length === 0) throw new EmptyTranscriptError();

    return {
      status: 'OK',
      transcript,
      provider: this.name,
      model: this.model,
      ...(payload.language ?? language ? { language: payload.language ?? language } : {}),
      ...(payload.duration === undefined
        ? input.durationSeconds === undefined
          ? {}
          : { durationSeconds: input.durationSeconds }
        : { durationSeconds: payload.duration }),
    };
  }
}

function summarise(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface TranscriptionEnv {
  readonly TRANSCRIPTION_PROVIDER?: string;
  readonly OPENAI_API_KEY?: string;
  readonly TRANSCRIPTION_MODEL?: string;
}

/**
 * Picks a provider from the environment.
 *
 * Never throws: a missing key degrades to the local provider, which is a
 * working path, not an error state.
 */
export function createTranscriptionProvider(
  env: TranscriptionEnv,
  deps: { fetch?: FetchLike; clock?: Clock; retry?: RetryPolicy } = {},
): TranscriptionProvider {
  const provider = (env.TRANSCRIPTION_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = env.OPENAI_API_KEY?.trim();
  const wantsOpenAI = provider === 'openai' || (provider === '' && Boolean(apiKey));
  if (!wantsOpenAI || !apiKey) return new LocalTranscriptionProvider();
  return new OpenAIWhisperProvider({
    apiKey,
    ...(env.TRANSCRIPTION_MODEL ? { model: env.TRANSCRIPTION_MODEL } : {}),
    ...deps,
  });
}

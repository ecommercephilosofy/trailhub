import { describe, expect, it } from 'vitest';
import { fakeClock, type FetchLike } from '../util/http';
import {
  AudioTooLargeError,
  AudioTooLongError,
  EmptyAudioError,
  EmptyTranscriptError,
  LocalTranscriptionProvider,
  MAX_AUDIO_BYTES,
  OpenAIWhisperProvider,
  TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
  TranscriptionRequestError,
  UnsupportedAudioFormatError,
  createTranscriptionProvider,
  validateAudioInput,
  type AudioInput,
} from './transcription';

const audio = (overrides: Partial<AudioInput> = {}): AudioInput => ({
  kind: 'audio',
  data: new Uint8Array([1, 2, 3, 4]),
  format: 'm4a',
  durationSeconds: 42,
  ...overrides,
});

function harness(
  respond: (call: { url: string; init: RequestInit }, attempt: number) => Response,
): { fetchImpl: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    calls.push({ url, init });
    return respond({ url, init }, calls.length);
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('audio validation', () => {
  it('accepts the four supported formats', () => {
    for (const format of ['m4a', 'mp3', 'wav', 'webm', '.MP3', 'audio/wav']) {
      expect(() => validateAudioInput(audio({ format }))).not.toThrow();
    }
  });

  it('rejects anything else with a typed error', () => {
    expect(() => validateAudioInput(audio({ format: 'ogg' }))).toThrow(UnsupportedAudioFormatError);
    expect(() => validateAudioInput(audio({ format: 'flac' }))).toThrow(UnsupportedAudioFormatError);
  });

  it('rejects empty, oversized and overlong audio', () => {
    expect(() => validateAudioInput(audio({ data: new Uint8Array(0) }))).toThrow(EmptyAudioError);
    expect(() =>
      validateAudioInput(audio({ data: new Uint8Array(MAX_AUDIO_BYTES + 1) })),
    ).toThrow(AudioTooLargeError);
    expect(() => validateAudioInput(audio({ durationSeconds: 60 * 60 }))).toThrow(AudioTooLongError);
  });
});

describe('LocalTranscriptionProvider', () => {
  it('reports NOT_CONFIGURED instead of inventing a transcript', async () => {
    const result = await new LocalTranscriptionProvider().transcribe(audio());
    expect(result.status).toBe('NOT_CONFIGURED');
    if (result.status !== 'NOT_CONFIGURED') throw new Error('unreachable');
    expect(result.message).toBe(TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
    expect(result.message).toContain('OPENAI_API_KEY');
    expect(result.message).toContain('TRANSCRIPTION_PROVIDER');
    expect(result.missing).toEqual(['TRANSCRIPTION_PROVIDER', 'OPENAI_API_KEY']);
    // Crucially: no `transcript` key at all, so nothing downstream can mistake
    // an unconfigured provider for an empty recording.
    expect(result).not.toHaveProperty('transcript');
  });

  it('accepts a manually pasted transcript as a first-class input', async () => {
    const result = await new LocalTranscriptionProvider().transcribe({
      kind: 'manual',
      transcript: '  He trucat a Caves Solé i volen preus.  ',
      language: 'ca',
    });
    expect(result).toEqual({
      status: 'OK',
      transcript: 'He trucat a Caves Solé i volen preus.',
      provider: 'local',
      language: 'ca',
    });
  });

  it('still validates the audio so the user learns about a bad file', async () => {
    await expect(
      new LocalTranscriptionProvider().transcribe(audio({ format: 'ogg' })),
    ).rejects.toBeInstanceOf(UnsupportedAudioFormatError);
  });

  it('rejects an empty pasted transcript', async () => {
    await expect(
      new LocalTranscriptionProvider().transcribe({ kind: 'manual', transcript: '   ' }),
    ).rejects.toBeInstanceOf(EmptyTranscriptError);
  });
});

describe('OpenAIWhisperProvider', () => {
  it('uploads multipart and returns the transcript', async () => {
    const { fetchImpl, calls } = harness(() =>
      json({ text: 'He trucat a Caves Solé.', language: 'ca', duration: 12.5 }),
    );
    const provider = new OpenAIWhisperProvider({
      apiKey: 'sk-test-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    const result = await provider.transcribe(audio({ language: 'ca' }));

    expect(result).toMatchObject({
      status: 'OK',
      transcript: 'He trucat a Caves Solé.',
      provider: 'openai',
      model: 'whisper-1',
      language: 'ca',
      durationSeconds: 12.5,
    });

    const init = calls[0]?.init as RequestInit;
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key');
    // No hand-set content-type: fetch must own the multipart boundary.
    expect(init.headers).not.toHaveProperty('content-type');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('ca');
    expect(form.get('temperature')).toBe('0');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('short-circuits a pasted transcript without touching the network', async () => {
    const { fetchImpl, calls } = harness(() => json({}));
    const provider = new OpenAIWhisperProvider({ apiKey: 'sk-test-key', fetch: fetchImpl });
    const result = await provider.transcribe({ kind: 'manual', transcript: 'Text enganxat' });
    expect(result.status).toBe('OK');
    expect(calls).toHaveLength(0);
  });

  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    const clock = fakeClock();
    const { fetchImpl, calls } = harness((_call, attempt) => {
      if (attempt === 1) return json({ error: { message: 'slow down' } }, 429, { 'retry-after': '3' });
      if (attempt === 2) return json({ error: { message: 'boom' } }, 503);
      return json({ text: 'ok' });
    });
    const provider = new OpenAIWhisperProvider({
      apiKey: 'sk-test-key',
      fetch: fetchImpl,
      clock,
      retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    const result = await provider.transcribe(audio());
    expect(result.status).toBe('OK');
    expect(calls).toHaveLength(3);
    expect(clock.slept[0]).toBe(3000); // honoured Retry-After
  });

  it('does not retry a 4xx that will never succeed', async () => {
    const { fetchImpl, calls } = harness(() =>
      json({ error: { message: 'Invalid file format' } }, 400),
    );
    const provider = new OpenAIWhisperProvider({
      apiKey: 'sk-test-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    await expect(provider.transcribe(audio())).rejects.toBeInstanceOf(TranscriptionRequestError);
    expect(calls).toHaveLength(1);
  });

  it('rejects an empty transcription result', async () => {
    const { fetchImpl } = harness(() => json({ text: '   ' }));
    const provider = new OpenAIWhisperProvider({
      apiKey: 'sk-test-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    await expect(provider.transcribe(audio())).rejects.toBeInstanceOf(EmptyTranscriptError);
  });

  it('never puts the API key in an error message', async () => {
    const { fetchImpl } = harness(() =>
      json({ error: { message: 'Incorrect API key provided: sk-test-key-abcdefghijklmnop' } }, 401),
    );
    const provider = new OpenAIWhisperProvider({
      apiKey: 'sk-test-key-abcdefghijklmnop',
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    const error = (await provider.transcribe(audio()).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('sk-test-key-abcdefghijklmnop');
  });
});

describe('createTranscriptionProvider', () => {
  it('degrades to the local provider without a key', () => {
    expect(createTranscriptionProvider({}).name).toBe('local');
    expect(createTranscriptionProvider({ TRANSCRIPTION_PROVIDER: 'openai' }).name).toBe('local');
  });

  it('uses OpenAI when configured', () => {
    expect(
      createTranscriptionProvider({ TRANSCRIPTION_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' }).name,
    ).toBe('openai');
    // A key with no explicit provider is taken as intent.
    expect(createTranscriptionProvider({ OPENAI_API_KEY: 'sk-x' }).name).toBe('openai');
  });

  it('respects an explicit local choice even when a key exists', () => {
    expect(
      createTranscriptionProvider({ TRANSCRIPTION_PROVIDER: 'local', OPENAI_API_KEY: 'sk-x' }).name,
    ).toBe('local');
  });
});

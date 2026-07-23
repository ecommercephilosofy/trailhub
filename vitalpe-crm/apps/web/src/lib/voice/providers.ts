import 'server-only';
import {
  AnthropicInterpreter,
  LocalInterpreter,
  LocalTranscriptionProvider,
  OpenAIWhisperProvider,
  type CommercialActionInterpreter,
  type TranscriptionProvider,
} from '@vitalpe/integrations';

/**
 * Provider selection.
 *
 * Credentials present -> the real provider. Credentials absent -> the local
 * one, which is a working implementation and not a stub: the deterministic
 * interpreter genuinely reads a sentence, and the local transcription path
 * accepts a pasted transcript. The whole capture → preview → confirm flow is
 * therefore exercisable with no API keys at all.
 */

export interface ProviderInfo {
  name: string;
  configured: boolean;
  /** Shown in the UI when the real provider is not available. */
  notice: string | null;
}

export function transcriptionProvider(): { provider: TranscriptionProvider; info: ProviderInfo } {
  const kind = (process.env.TRANSCRIPTION_PROVIDER ?? 'local').toLowerCase();
  const key = process.env.OPENAI_API_KEY;

  if (kind === 'openai' && key) {
    return {
      provider: new OpenAIWhisperProvider({
        apiKey: key,
        ...(process.env.TRANSCRIPTION_MODEL ? { model: process.env.TRANSCRIPTION_MODEL } : {}),
      }),
      info: { name: 'OpenAI Whisper', configured: true, notice: null },
    };
  }

  return {
    provider: new LocalTranscriptionProvider(),
    info: {
      name: 'local',
      configured: false,
      notice:
        'La transcripció automàtica no està configurada. Pots enganxar la transcripció a mà i la resta del flux funciona igual. Per activar-la, defineix TRANSCRIPTION_PROVIDER=openai i OPENAI_API_KEY.',
    },
  };
}

export function interpreter(): { provider: CommercialActionInterpreter; info: ProviderInfo } {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return {
      provider: new AnthropicInterpreter({
        apiKey: key,
        ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
      }),
      info: { name: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8', configured: true, notice: null },
    };
  }
  return {
    provider: new LocalInterpreter(),
    info: {
      name: 'intèrpret local determinista',
      configured: false,
      notice:
        "S'està utilitzant l'intèrpret local determinista: reconeix empresa, acció, resultat, producte, prioritat i dates habituals. Per a llenguatge lliure, defineix ANTHROPIC_API_KEY.",
    },
  };
}

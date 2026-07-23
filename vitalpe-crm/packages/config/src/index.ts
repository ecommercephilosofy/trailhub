/**
 * @vitalpe/config — environment loading, integration status and secret crypto.
 *
 * Two rules govern everything in this package:
 *
 *  1. The application must boot and be fully usable with only the APP and
 *     SUPABASE variables set. Every integration variable is optional and its
 *     absence degrades to the local provider — never to a crash.
 *  2. Server-only values never reach the client bundle. `serverEnv()` and the
 *     crypto helpers throw if they are ever evaluated in a browser.
 */
export {
  // schemas + loaders
  loadPublicEnv,
  loadServerEnv,
  publicEnv,
  serverEnv,
  resetEnvCache,
  // metadata
  ENV_VARIABLES,
  REQUIRED_SERVER_VARIABLES,
  REQUIRED_PUBLIC_VARIABLES,
  OPTIONAL_VARIABLES,
  // status
  integrationStatus,
  isIntegrationConfigured,
  EnvironmentError,
  ServerEnvOnClientError,
} from './env';

export type {
  PublicEnv,
  ServerEnv,
  EnvSource,
  EnvVariableSpec,
  EnvGroup,
  IntegrationKey,
  IntegrationStatus,
  IntegrationStatusReport,
} from './env';

export {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  CIPHER_VERSION,
  CryptoError,
  DecryptionError,
} from './crypto';

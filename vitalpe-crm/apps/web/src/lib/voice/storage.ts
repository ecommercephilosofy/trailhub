import 'server-only';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Audio storage.
 *
 * Supabase Storage when configured (private bucket, signed URLs); otherwise a
 * private directory outside the web root. Either way the bytes are never
 * publicly addressable: playback goes through an authenticated route that
 * checks ownership through RLS first.
 */

const LOCAL_DIR = process.env.VOICE_AUDIO_DIR ?? path.resolve(process.cwd(), '../../.data/audio');
const BUCKET = 'notes-de-veu';

export interface StoredAudio {
  path: string;
  bytes: number;
}

function usingSupabase(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function storeAudio(
  workspaceId: string,
  userId: string,
  data: Buffer,
  extension: string,
): Promise<StoredAudio> {
  const key = `${workspaceId}/${userId}/${randomUUID()}.${extension}`;

  if (usingSupabase()) {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': `audio/${extension}`,
        'x-upsert': 'false',
      },
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      throw new Error(`No s'ha pogut desar l'àudio (${res.status}).`);
    }
    return { path: `supabase:${key}`, bytes: data.byteLength };
  }

  const full = path.join(LOCAL_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { path: `local:${key}`, bytes: data.byteLength };
}

export async function readAudio(storedPath: string): Promise<Buffer> {
  if (storedPath.startsWith('supabase:')) {
    const key = storedPath.slice('supabase:'.length);
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new Error("No s'ha pogut llegir l'àudio.");
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(LOCAL_DIR, storedPath.slice('local:'.length)));
}

/** Used by the retention policy. Missing files are not an error. */
export async function deleteAudio(storedPath: string): Promise<void> {
  if (storedPath.startsWith('supabase:')) {
    const key = storedPath.slice('supabase:'.length);
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    }).catch(() => undefined);
    return;
  }
  await unlink(path.join(LOCAL_DIR, storedPath.slice('local:'.length))).catch(() => undefined);
}

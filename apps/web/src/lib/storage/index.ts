import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

/**
 * Object storage for Vault originals. Keys are minted here and never accepted from a request:
 * a key that arrived from outside is the whole path-traversal bug, so `storageKey()` is the only
 * way to make one and every backend re-validates the shape before touching a byte.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Backends that predate the key format implement this; the rest reject and the caller stops. */
  deleteLegacy?(key: string): Promise<void>;
}

/** The narrow subset of an R2 bucket binding used by the Vault storage adapter. */
export interface R2BucketBinding {
  put(key: string, value: ArrayBufferView): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
}

export class StorageError extends Error {
  constructor(public readonly code: 'invalid_key' | 'not_found' | 'backend', message: string) { super(message); }
}

/** office/uuid/uuid.ext — no user input, no separators beyond the ones this function writes. */
const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

export function storageKey(officeId: string, documentId: string, extension = ''): string {
  if (!/^[0-9a-f-]{36}$/i.test(officeId) || !/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new StorageError('invalid_key', 'Identificadores inválidos para armazenamento.');
  }
  const clean = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const suffix = clean && clean.startsWith('.') ? clean.slice(0, 9) : clean ? `.${clean}`.slice(0, 9) : '';
  return `${officeId.toLowerCase()}/${documentId.toLowerCase()}/${randomUUID()}${suffix}`;
}

export function assertStorageKey(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new StorageError('invalid_key', 'Referência de armazenamento inválida.');
  return key;
}

class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  /** Resolve inside the root and prove it, so a future key format change cannot reopen traversal. */
  private path(key: string) {
    const full = resolve(this.root, assertStorageKey(key));
    const rel = relative(this.root, full);
    if (!rel || rel.startsWith('..') || rel.startsWith(`${sep}..`) || resolve(this.root, rel) !== full) {
      throw new StorageError('invalid_key', 'Referência de armazenamento inválida.');
    }
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.path(key);
    await mkdir(resolve(full, '..'), { recursive: true });
    await writeFile(full, data, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new StorageError('not_found', 'Arquivo original não encontrado.');
      throw error;
    }
  }

  async delete(key: string) {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  /**
   * Rows written before the adapter existed hold a flat file name sitting directly in the root,
   * which `assertStorageKey` rejects. Deletion has to reach them or the bytes of a deleted
   * document stay on disk forever - the same fallback `readVaultOriginal` already makes for
   * reading, and safe for the same reason: a base name has no separators to escape with.
   */
  async deleteLegacy(key: string) {
    const name = basename(key);
    if (!name || name !== key || name === '.' || name === '..') {
      throw new StorageError('invalid_key', 'Referência de armazenamento inválida.');
    }
    await unlink(resolve(this.root, name)).catch((error: NodeJS.ErrnoException) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

/**
 * R2 over the S3-compatible API. Used by staging and production; the local backend stays the
 * default so a developer without credentials still has a working Vault.
 */
class R2ObjectStorage implements ObjectStorage {
  constructor(
    private readonly config: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string },
  ) {}

  private async client() {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: 'auto',
      endpoint: `https://${this.config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: assertStorageKey(key), Body: data }));
  }

  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: assertStorageKey(key) }));
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) throw new StorageError('not_found', 'Arquivo original não encontrado.');
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if ((error as { name?: string })?.name === 'NoSuchKey') throw new StorageError('not_found', 'Arquivo original não encontrado.');
      throw new StorageError('backend', 'Armazenamento de documentos indisponível.');
    }
  }

  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: assertStorageKey(key) }));
  }
}

/** R2 through the capability binding injected into the Cloudflare Worker. */
class BoundR2ObjectStorage implements ObjectStorage {
  constructor(private readonly binding: R2BucketBinding) {}

  async put(key: string, data: Buffer) {
    try {
      await this.binding.put(assertStorageKey(key), data);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('backend', 'Armazenamento de documentos indisponível.');
    }
  }

  async get(key: string) {
    try {
      const object = await this.binding.get(assertStorageKey(key));
      if (!object) throw new StorageError('not_found', 'Arquivo original não encontrado.');
      return Buffer.from(await object.arrayBuffer());
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('backend', 'Armazenamento de documentos indisponível.');
    }
  }

  async delete(key: string) {
    try {
      await this.binding.delete(assertStorageKey(key));
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('backend', 'Armazenamento de documentos indisponível.');
    }
  }
}

let cached: ObjectStorage | undefined;
let resolving: Promise<ObjectStorage> | undefined;
let testR2Binding: R2BucketBinding | undefined;

async function workerR2Binding(): Promise<R2BucketBinding | undefined> {
  try {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    return env.VAULT as R2BucketBinding | undefined;
  } catch {
    return undefined;
  }
}

async function resolveObjectStorage(): Promise<ObjectStorage> {
  if (cached) return cached;
  const bucket = process.env.R2_BUCKET;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  const binding = testR2Binding ?? await workerR2Binding();
  if (binding) return new BoundR2ObjectStorage(binding);
  if (bucket && accountId && accessKeyId && secretAccessKey) {
    return new R2ObjectStorage({ accountId, bucket, accessKeyId, secretAccessKey });
  }
  if (process.env.VAULT_STORAGE_BACKEND === 'r2') {
    throw new Error("R2 foi solicitado, mas o binding 'VAULT' e as credenciais S3 não estão disponíveis.");
  }
  return new LocalObjectStorage(resolve(process.env.VAULT_STORAGE_PATH ?? resolve(process.cwd(), '.data', 'uploads')));
}

export async function objectStorage(): Promise<ObjectStorage> {
  if (cached) return cached;
  resolving ??= resolveObjectStorage();
  try {
    cached = await resolving;
    return cached;
  } finally {
    resolving = undefined;
  }
}

/** Tests and the worker build their own instance instead of reaching for the module singleton. */
export function localObjectStorage(root: string): ObjectStorage {
  return new LocalObjectStorage(resolve(root));
}

export function resetObjectStorageForTests(storage?: ObjectStorage, binding?: R2BucketBinding) {
  cached = storage;
  resolving = undefined;
  testR2Binding = binding;
}

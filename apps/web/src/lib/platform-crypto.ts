import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
// v1: {v,iv,tag,data} without key id (legacy). v2 adds kid, the master key fingerprint.
const FORMAT_VERSION = 2;

export class CredentialKeyError extends Error {}
export class CredentialDecryptError extends Error {}

export type CredentialKeyring = { current: { id: string; key: Buffer }; keys: Map<string, Buffer> };

export function parseCredentialKey(value = process.env.K5_CREDENTIALS_KEY, name = "K5_CREDENTIALS_KEY"): Buffer {
  if (!value) throw new CredentialKeyError(`Configure ${name} com uma chave de 32 bytes em base64.`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new CredentialKeyError(`${name} deve estar em base64.`);
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new CredentialKeyError(`${name} deve representar exatamente 32 bytes.`);
  }
  return key;
}

// Non-secret identifier: truncated SHA-256 of the key, safe for storage and audit.
export function credentialKeyId(key: Uint8Array): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createCredentialKeyring(current: Uint8Array, previous: Uint8Array[] = []): CredentialKeyring {
  for (const key of [current, ...previous]) if (key.byteLength !== 32) throw new CredentialKeyError("A chave mestra deve ter 32 bytes.");
  const keys = new Map<string, Buffer>();
  for (const key of [current, ...previous]) if (!keys.has(credentialKeyId(key))) keys.set(credentialKeyId(key), Buffer.from(key));
  return { current: { id: credentialKeyId(current), key: Buffer.from(current) }, keys };
}

export function parseCredentialKeyring(current = process.env.K5_CREDENTIALS_KEY, previous = process.env.K5_CREDENTIALS_PREVIOUS_KEYS, next = process.env.K5_CREDENTIALS_NEXT_KEY): CredentialKeyring {
  const old = (previous ?? "").split(",").map((value) => value.trim()).filter(Boolean)
    .map((value) => parseCredentialKey(value, "K5_CREDENTIALS_PREVIOUS_KEYS"));
  // Keep the existing secret in the runtime while new writes adopt the staged key.
  // KEY may briefly be absent when the operator renames it to PREVIOUS_KEYS.
  if (next?.trim()) {
    if (current?.trim()) old.unshift(parseCredentialKey(current));
    return createCredentialKeyring(parseCredentialKey(next, "K5_CREDENTIALS_NEXT_KEY"), old);
  }
  return createCredentialKeyring(parseCredentialKey(current), old);
}

function keyringOf(key: Uint8Array | CredentialKeyring): CredentialKeyring {
  return key instanceof Uint8Array ? createCredentialKeyring(key) : key;
}

type Envelope = { v?: unknown; kid?: unknown; iv?: unknown; tag?: unknown; data?: unknown };

function parseEnvelope(payload: string) {
  let value: Envelope;
  try { value = JSON.parse(payload); } catch { throw new CredentialDecryptError("Credencial criptografada inválida."); }
  if (!value || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.data !== "string"
    || !(value.v === 1 || (value.v === 2 && typeof value.kid === "string"))) {
    throw new CredentialDecryptError("Formato de credencial criptografada não suportado.");
  }
  return value as { v: 1 | 2; kid?: string; iv: string; tag: string; data: string };
}

export function encryptCredential(plaintext: string, key: Uint8Array | CredentialKeyring): string {
  if (!plaintext.trim()) throw new Error("A chave do provider é obrigatória.");
  const { current } = keyringOf(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, current.key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: FORMAT_VERSION,
    kid: current.id,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

export function decryptCredential(payload: string, key: Uint8Array | CredentialKeyring): string {
  const keyring = keyringOf(key);
  const value = parseEnvelope(payload);
  // Legacy v1 payloads have no key id: try the current key first, then previous keys.
  const candidates = value.v === 2 ? [keyring.keys.get(value.kid!)].filter((item) => item !== undefined) : [...keyring.keys.values()];
  if (!candidates.length) throw new CredentialDecryptError("A chave mestra desta credencial não está configurada.");
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, candidate, Buffer.from(value.iv, "base64"));
      decipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
    } catch { /* try next key */ }
  }
  throw new CredentialDecryptError("Não foi possível descriptografar a credencial.");
}

export function credentialNeedsReencryption(payload: string, key: Uint8Array | CredentialKeyring): boolean {
  const value = parseEnvelope(payload);
  return value.v !== FORMAT_VERSION || value.kid !== keyringOf(key).current.id;
}

export function credentialHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

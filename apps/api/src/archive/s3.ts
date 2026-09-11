import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { AppConfig } from "../config.js";
import { ArchiveIntegrityError, type ObservationArchive } from "./types.js";

/**
 * Narrow client interface so tests can inject an in-memory fake — the real
 * client only needs `send(command)`.
 */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

interface S3ErrorLike {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

const isNotFound = (e: unknown): boolean => {
  const err = e as S3ErrorLike;
  return (
    err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey"
  );
};

const isPreconditionFailed = (e: unknown): boolean => {
  const err = e as S3ErrorLike;
  return err?.$metadata?.httpStatusCode === 412 || err?.name === "PreconditionFailed";
};

const sha256hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sha256b64 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("base64");

const contentType = (key: string): string | undefined => {
  if (key.endsWith(".parquet")) return "application/vnd.apache.parquet";
  if (key.endsWith(".json")) return "application/json";
  return undefined;
};

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (
    body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function"
  ) {
    return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  }
  if (body && Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error("S3 GetObject returned no readable body");
}

/**
 * S3-compatible archive backend (AWS S3, Cloudflare R2, MinIO).
 *
 * Writes are guarded: PutObject carries `IfNoneMatch: "*"` plus a SHA-256
 * checksum, so a raced or replayed write never silently overwrites. If an
 * object already exists we compare its sha256 — equal means idempotent
 * re-put (return), different means corruption (throw). Retries are at the SDK
 * level (maxAttempts 4, adaptive). Objects are batch-sized (≤50k rows), so the
 * 5 GiB single-PUT ceiling is unreachable.
 */
export class S3CompatibleArchive implements ObservationArchive {
  constructor(
    private readonly client: S3ClientLike,
    private readonly bucket: string,
    private readonly prefix = "",
  ) {}

  private fullKey(key: string): string {
    return this.prefix + key;
  }

  async putObject(key: string, bytes: Uint8Array): Promise<void> {
    const hex = sha256hex(bytes);
    const fullKey = this.fullKey(key);
    if (await this.exists(key)) {
      const existing = await this.getObject(key);
      if (sha256hex(existing) === hex) return; // idempotent re-put
      throw new ArchiveIntegrityError(
        `archive object ${key} exists with different checksum — refusing to overwrite`,
      );
    }
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
          Body: bytes,
          ChecksumSHA256: sha256b64(bytes),
          IfNoneMatch: "*",
          ContentType: contentType(key),
        }),
      );
    } catch (e) {
      if (!isPreconditionFailed(e)) throw e;
      // Lost a write race — compare once, then decide.
      const existing = await this.getObject(key);
      if (sha256hex(existing) === hex) return;
      throw new ArchiveIntegrityError(
        `archive object ${key} exists with different checksum — refusing to overwrite`,
      );
    }
  }

  async getObject(key: string): Promise<Uint8Array> {
    const res = (await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
    )) as { Body: unknown };
    return bodyToBytes(res.Body);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.fullKey(prefix),
          ContinuationToken: token,
        }),
      )) as { Contents?: Array<{ Key?: string }>; NextContinuationToken?: string };
      for (const obj of res.Contents ?? []) {
        if (obj.Key) out.push(obj.Key.slice(this.prefix.length));
      }
      token = res.NextContinuationToken;
    } while (token);
    return out.sort();
  }
}

export function createS3Archive(config: AppConfig): S3CompatibleArchive {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    },
    maxAttempts: 4,
    requestHandler: new NodeHttpHandler({
      requestTimeout: config.S3_REQUEST_TIMEOUT_MS,
      connectionTimeout: 5000,
    }),
  });
  return new S3CompatibleArchive(client as unknown as S3ClientLike, config.S3_BUCKET!);
}

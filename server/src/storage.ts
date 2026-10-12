import { createClient } from "@supabase/supabase-js";

/**
 * Where uploaded avatar images are kept. The app only needs these two
 * operations, so tests can swap in a fake and another provider (S3, R2, …)
 * would only need a new implementation of this interface.
 */
export interface AvatarStorage {
  /** Stores the file under `key` and returns its public URL. */
  save(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ url: string }>;
  remove(key: string): Promise<void>;
}

/**
 * Where pictures sent in chats are kept. Unlike avatars these are private:
 * files have no public URL, so the only way to get one is through the server,
 * which checks who's asking first (GET /api/images/:messageId).
 */
export interface ChatImageStorage {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface SupabaseStorageOptions {
  /** Project URL, e.g. https://abcd1234.supabase.co */
  url: string;
  /** Secret key (sb_secret_…) or legacy service_role key. Server-side only! */
  secretKey: string;
  /** A *public* bucket for avatars (so their URLs can be shown in <img> tags), a *private* one for chat images. */
  bucket: string;
}

function bucketFiles({ url, secretKey, bucket }: SupabaseStorageOptions) {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase.storage.from(bucket);
}

/** Avatar storage backed by a public Supabase Storage bucket. */
export function createSupabaseStorage(
  options: SupabaseStorageOptions,
): AvatarStorage {
  const files = bucketFiles(options);

  return {
    async save(key, data, contentType) {
      const { error } = await files.upload(key, data, {
        contentType,
        // Every upload gets a new key, so the file at a URL never changes and
        // browsers/CDNs may cache it for a year.
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw new Error(`Supabase upload failed: ${error.message}`);
      return { url: files.getPublicUrl(key).data.publicUrl };
    },
    async remove(key) {
      const { error } = await files.remove([key]);
      if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    },
  };
}

/** Chat image storage backed by a private Supabase Storage bucket. */
export function createSupabaseChatImageStorage(
  options: SupabaseStorageOptions,
): ChatImageStorage {
  const files = bucketFiles(options);

  return {
    async save(key, data, contentType) {
      const { error } = await files.upload(key, data, {
        contentType,
        upsert: false,
      });
      if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    },
    async read(key) {
      const { data, error } = await files.download(key);
      if (error) throw new Error(`Supabase download failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(key) {
      const { error } = await files.remove([key]);
      if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    },
  };
}

/**
 * Builds Supabase storage from SUPABASE_URL / SUPABASE_SECRET_KEY /
 * SUPABASE_BUCKET, or returns null when they aren't set (uploads then reply
 * "storage isn't configured" and everything else keeps working).
 */
export function storageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AvatarStorage | null {
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  return createSupabaseStorage({
    url,
    secretKey,
    bucket: env.SUPABASE_BUCKET || "avatars",
  });
}

/** Same, for chat images: the private bucket named by SUPABASE_CHAT_BUCKET. */
export function chatImageStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ChatImageStorage | null {
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  return createSupabaseChatImageStorage({
    url,
    secretKey,
    bucket: env.SUPABASE_CHAT_BUCKET || "chat-images",
  });
}

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

/**
 * Identifies an image by its first bytes ("magic numbers") instead of trusting
 * the Content-Type header, which the client controls.
 */
export function detectImageType(data: Buffer): ImageType | null {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

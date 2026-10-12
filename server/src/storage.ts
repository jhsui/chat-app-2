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

export interface SupabaseStorageOptions {
  /** Project URL, e.g. https://abcd1234.supabase.co */
  url: string;
  /** Secret key (sb_secret_…) or legacy service_role key. Server-side only! */
  secretKey: string;
  /** A *public* bucket, so avatar URLs can be shown in <img> tags. */
  bucket: string;
}

/** Avatar storage backed by a Supabase Storage bucket. */
export function createSupabaseStorage({
  url,
  secretKey,
  bucket,
}: SupabaseStorageOptions): AvatarStorage {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const files = supabase.storage.from(bucket);

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

/**
 * Shrinks photos in the browser before they're uploaded, so a phone picture of
 * several MB becomes a few hundred KB at most. Re-encoding also drops the
 * photo's metadata (such as where it was taken).
 */

/** A picture ready to send in a chat, with its size in pixels. */
export interface ChatImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Must not be more than MAX_IMAGE_BYTES on the server. */
const MAX_CHAT_IMAGE_BYTES = 1024 * 1024;

async function decode(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }
  try {
    // Also applies the photo's EXIF rotation, so phone pictures aren't sideways.
    return await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Try a JPG or PNG.");
  }
}

/** Draws a region of the image onto a new canvas of the given size. */
function draw(
  bitmap: ImageBitmap,
  source: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    width,
    height,
  );
  return canvas;
}

/** Encodes a canvas as WebP (or JPEG where WebP encoding isn't supported). */
async function encode(canvas: HTMLCanvasElement, quality: number) {
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality),
    );

  // Browsers that can't encode WebP silently return PNG instead, so check the type.
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("Couldn't process that image");
  return jpeg;
}

/**
 * Turns any photo the user picks into a small square avatar: center-crop to a
 * square and resize to `size`×`size` (~20–40 KB).
 */
export async function toSquareAvatar(file: File, size = 256): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const crop = {
      x: (bitmap.width - side) / 2,
      y: (bitmap.height - side) / 2,
      width: side,
      height: side,
    };
    return await encode(draw(bitmap, crop, size, size), 0.85);
  } finally {
    bitmap.close();
  }
}

/**
 * Prepares a picture for sending in a chat: keeps its shape, and scales it
 * down so the longer side is at most 1600px.
 */
export async function toChatImage(file: Blob): Promise<ChatImage> {
  const bitmap = await decode(file);
  try {
    const whole = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    // The first attempt nearly always fits the upload limit; very detailed
    // pictures get smaller and more compressed until they do.
    for (const [maxSide, quality] of [
      [1600, 0.82],
      [1200, 0.7],
      [800, 0.6],
    ] as const) {
      const scale = Math.min(
        1,
        maxSide / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const blob = await encode(draw(bitmap, whole, width, height), quality);
      if (blob.size <= MAX_CHAT_IMAGE_BYTES) return { blob, width, height };
    }
    throw new Error("That image is too large to send");
  } finally {
    bitmap.close();
  }
}

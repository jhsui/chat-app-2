/**
 * Turns any photo the user picks into a small square avatar, in the browser,
 * before uploading: center-crop to a square, resize to `size`×`size`, and
 * encode as WebP (or JPEG where WebP encoding isn't supported). A phone photo
 * of several MB becomes ~20–40 KB.
 */
export async function toSquareAvatar(file: File, size = 256): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }

  let bitmap: ImageBitmap;
  try {
    // Also applies the photo's EXIF rotation, so phone pictures aren't sideways.
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Try a JPG or PNG.");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality),
    );

  // Browsers that can't encode WebP silently return PNG instead, so check the type.
  const webp = await encode("image/webp", 0.85);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg", 0.88);
  if (!jpeg) throw new Error("Couldn't process that image");
  return jpeg;
}

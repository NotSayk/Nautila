/** Réduction côté client des très grandes images avant leur enregistrement dans la base. */

/** Au-delà de cette taille (en pixels, sur un côté) ou de ce poids, l'image est réduite et recompressée. */
export const MAX_SIDE = 2400;
export const MAX_BYTES = 1.5 * 1024 * 1024;

/** Formats concernés : les GIF (animés) et les SVG (vectoriels) ne sont jamais touchés. */
const SHRINKABLE = /^image\/(png|jpeg|webp|bmp)$/;

export const isShrinkable = (type: string) => SHRINKABLE.test(type);

/** Taille à donner à une image pour que son grand côté ne dépasse pas `max` (jamais d'agrandissement). */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Faut-il toucher à cette image ? (grande en pixels ou lourde, et d'un format réductible) */
export function needsShrink(type: string, bytes: number, width: number, height: number): boolean {
  return isShrinkable(type) && (bytes > MAX_BYTES || Math.max(width, height) > MAX_SIDE);
}

const extensionFor = (type: string) => (type === "image/webp" ? "webp" : "jpg");

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Renvoie le fichier tel quel s'il est petit (ou d'un autre format), sinon une version réduite à
 * 2400 px de côté au plus et recompressée. En cas de doute (image illisible, résultat plus lourd), l'original.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!isShrinkable(file.type) || typeof createImageBitmap !== "function") return file;
  // Une image très légère n'est même pas décodée.
  if (file.size < 200_000) return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    if (!needsShrink(file.type, file.size, bitmap.width, bitmap.height)) return file;
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    // WebP garde la transparence ; les navigateurs qui ne savent pas l'écrire renvoient du PNG, qu'on remplace par du JPEG.
    let blob = await toBlob(canvas, "image/webp", 0.85);
    if (!blob || blob.type !== "image/webp") {
      const flat = document.createElement("canvas");
      flat.width = width;
      flat.height = height;
      const flatCtx = flat.getContext("2d");
      if (!flatCtx) return file;
      flatCtx.fillStyle = "#fff";
      flatCtx.fillRect(0, 0, width, height);
      flatCtx.drawImage(bitmap, 0, 0, width, height);
      blob = await toBlob(flat, "image/jpeg", 0.85);
    }
    if (!blob) return file;
    const resized = width !== bitmap.width || height !== bitmap.height;
    // Une recompression qui n'allège pas ne vaut pas la perte de qualité.
    if (!resized && blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^./\\]+$/, "") + "." + extensionFor(blob.type), { type: blob.type });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

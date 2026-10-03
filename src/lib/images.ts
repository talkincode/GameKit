/**
 * Pictures the child pastes or picks for the ask box.
 *
 * They are reference material for one round, not project files: nothing here
 * touches the project or `assets/`. Images are downscaled and re-encoded before
 * leaving the browser, so a phone screenshot does not become a huge upload.
 */
export type PreparedImage = {
  /** What the model receives; also what the dialog shows as a thumbnail. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

const MAX_EDGE = 1024;
const QUALITY = 0.85;

export const MAX_ATTACHMENTS = 4;

function readIntoImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await readIntoImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot read pictures.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75) };
}

/** Files from a paste, a drop or a file picker, filtered to pictures we can read. */
export function imagesFrom(list: FileList | File[] | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

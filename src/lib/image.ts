/** Image pipeline: compress to a JPEG ≤ maxDim, produce a full-size data URL
 *  (for Gemini) and a small thumbnail data URL (for lists and spreadsheet export). */

export interface ProcessedImage {
  blob: Blob; // compressed JPEG
  dataUrl: string; // full-size JPEG data URL
  thumbDataUrl: string; // ≤ thumbDim JPEG data URL
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Fallback for odd formats / older engines
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read this image file'));
      };
      img.src = url;
    });
  }
}

function drawScaled(source: ImageBitmap | HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const w = 'width' in source && typeof source.width === 'number' ? source.width : (source as HTMLImageElement).naturalWidth;
  const h = 'height' in source && typeof source.height === 'number' ? source.height : (source as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function processImageFile(
  file: Blob,
  opts: { maxDim?: number; quality?: number; thumbDim?: number } = {},
): Promise<ProcessedImage> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.85;
  const thumbDim = opts.thumbDim ?? 300;

  const source = await decode(file);
  try {
    const canvas = drawScaled(source, maxDim);
    const thumb = canvas.width > thumbDim || canvas.height > thumbDim ? drawScaled(source, thumbDim) : canvas;
    const [blob, thumbDataUrl] = await Promise.all([
      canvasToBlob(canvas, quality),
      Promise.resolve(thumb.toDataURL('image/jpeg', 0.8)),
    ]);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      blob,
      dataUrl,
      thumbDataUrl,
      width: canvas.width,
      height: canvas.height,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
    };
  } finally {
    if ('close' in source) source.close();
  }
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export function arrayBufferToBlob(buf: ArrayBuffer, type: string): Blob {
  return new Blob([buf], { type });
}

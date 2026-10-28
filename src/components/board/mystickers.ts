/*
 * "My stickers": images Pastel adds herself. Kept in this browser
 * (IndexedDB), resized to at most 512 px, reusable on any board.
 */
import { get, set } from 'idb-keyval';

export type MySticker = { id: string; name: string; blob: Blob; at: number };

const KEY = 'pastelux-my-stickers';
const MAX_SIDE = 512;
export const MAX_MINE = 300;

export async function loadMine(): Promise<MySticker[]> {
  return ((await get(KEY).catch(() => null)) as MySticker[] | null) ?? [];
}

async function saveMine(list: MySticker[]) {
  await set(KEY, list);
}

const loadImage = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });

/**
 * Clears a plain light background that touches the edges (white or near
 * white), the usual case for cartoon stickers saved from the web. Pixels
 * inside the drawing stay, even if they are white, because only regions
 * connected to the border are cleared.
 */
function clearEdgeBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const light = (i: number) => px[i + 3] > 0 && px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!light(p * 4)) continue;
    px[p * 4 + 3] = 0;
    cleared++;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  // only keep the result when there really was a border background
  if (cleared > w * h * 0.05) ctx.putImageData(data, 0, 0);
}

export async function prepareSticker(file: Blob, removeLightBg: boolean): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: removeLightBg })!;
  ctx.drawImage(img, 0, 0, w, h);
  if (removeLightBg) clearEdgeBackground(ctx, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
}

export async function addMine(files: Blob[], names: string[], removeLightBg: boolean) {
  const list = await loadMine();
  const added: MySticker[] = [];
  for (let i = 0; i < files.length && list.length + added.length < MAX_MINE; i++) {
    try {
      const blob = await prepareSticker(files[i], removeLightBg);
      added.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: names[i] || 'Sticker', blob, at: Date.now() });
    } catch {
      /* skip files that are not images */
    }
  }
  const next = [...added, ...list];
  await saveMine(next);
  return { list: next, added: added.length, full: list.length + added.length >= MAX_MINE };
}

export async function removeMine(id: string) {
  const next = (await loadMine()).filter((x) => x.id !== id);
  await saveMine(next);
  return next;
}

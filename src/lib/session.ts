import type { WebBundle } from "./build";

const CACHE = "gamekit-play-1";

export async function ensurePlayerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser cannot preview games because service workers are unavailable.");
  }
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 2000);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  if (!navigator.serviceWorker.controller) {
    throw new Error("The preview service worker is not in control yet. Reload GameKit, then press Run.");
  }
}

export async function publishPlay(session: string, bundle: WebBundle): Promise<string> {
  const cache = await caches.open(CACHE);
  const prefix = `${location.origin}/play/${session}/`;
  const keys = await cache.keys();
  await Promise.all(keys.map((key) => cache.delete(key)));
  await put(cache, `${prefix}index.html`, bundle.html, "text/html; charset=utf-8");
  await put(cache, `${prefix}${bundle.archiveName}.apk`, bytesBlob(bundle.apk), "application/octet-stream");
  await put(cache, `${prefix}favicon.png`, bytesBlob(bundle.favicon), "image/png");
  return `/play/${session}/index.html`;
}

async function put(cache: Cache, url: string, body: BodyInit, type: string) {
  await cache.put(
    url,
    new Response(body, {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    }),
  );
}

function bytesBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy]);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytesBlob(bytes)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Photos attached to personal points.
 *
 * One photo per point, for recognition — *this* is the right gully, *this* is
 * where the ford is. Stored in IndexedDB keyed by the point's own id, because
 * `localStorage` holds about 5 MB, is synchronous, and takes strings only; a
 * single photo would fill it and take the user's marks down with it.
 *
 * The original is never kept. Photos share the origin's storage budget with the
 * downloaded map tiles — a couple of hundred megabytes the user is going to
 * depend on with no signal — and a modern phone photo is 3-5 MB against the
 * ~200 KB of the two derivatives here. Re-encoding also strips EXIF as a side
 * effect, so GPS, timestamp and device model never reach the disk.
 */

const DB_NAME = "act-photos";
const STORE = "photos";
const DB_VERSION = 1;

/** Long edge of the copy shown in a popup. An iPad popup is ~300 CSS px wide. */
const FULL_EDGE = 1280;
/** Long edge of the list thumbnail, displayed at ~48 px, so twice that for retina. */
const THUMB_EDGE = 160;

const FULL_QUALITY = 0.75;
const THUMB_QUALITY = 0.7;

export type StoredPhoto = { id: string; thumb: Blob; full: Blob };

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the photo store."));
  });
  // A failed open must not be cached, or every later call fails with it.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Photo store request failed."));
      }),
  );
}

export function putPhoto(id: string, thumb: Blob, full: Blob): Promise<unknown> {
  return run("readwrite", (s) => s.put({ id, thumb, full } satisfies StoredPhoto));
}

export function getPhoto(id: string): Promise<StoredPhoto | undefined> {
  return run<StoredPhoto | undefined>("readonly", (s) => s.get(id));
}

export function deletePhoto(id: string): Promise<unknown> {
  return run("readwrite", (s) => s.delete(id));
}

export function listPhotoIds(): Promise<string[]> {
  return run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((keys) =>
    keys.map((k) => String(k)),
  );
}

/** Total bytes held, for the storage line in the panel. */
export async function photoBytes(): Promise<number> {
  const all = await run<StoredPhoto[]>("readonly", (s) => s.getAll());
  return all.reduce((n, p) => n + p.thumb.size + p.full.size, 0);
}

/**
 * Drop photos whose point no longer exists.
 *
 * The two stores can drift — a point deleted while the photo delete failed, or
 * a `localStorage` write refused after the photo was saved. Without a sweep the
 * orphans would sit there consuming the same budget as the map tiles, invisible.
 */
export async function pruneOrphans(liveIds: Iterable<string>): Promise<number> {
  const live = new Set(liveIds);
  const stored = await listPhotoIds();
  const orphans = stored.filter((id) => !live.has(id));
  await Promise.all(orphans.map((id) => deletePhoto(id).catch(() => {})));
  return orphans.length;
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

type Decoded = { draw: CanvasImageSource; width: number; height: number; done: () => void };

/**
 * Decode with EXIF orientation applied.
 *
 * A photo taken in portrait is usually stored landscape with an orientation
 * tag, and re-encoding through a canvas discards that tag — so unless the
 * rotation is baked in first, every portrait shot comes back on its side.
 * `createImageBitmap` states the intent explicitly; the `<img>` path is the
 * fallback, where browsers apply orientation during decode by default.
 */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        draw: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        done: () => bitmap.close(),
      };
    } catch {
      // Older Safari rejects the options argument; fall through.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image could not be read."));
      el.src = url;
    });
    return {
      draw: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      done: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function scaleTo(source: Decoded, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not process the image.");
  ctx.drawImage(source.draw, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be encoded."))),
      "image/jpeg",
      quality,
    );
  });
}

/** Turn a chosen file into the two derivatives that get stored. */
export async function processPhoto(file: Blob): Promise<{ thumb: Blob; full: Blob }> {
  const source = await decode(file);
  try {
    const full = await scaleTo(source, FULL_EDGE, FULL_QUALITY);
    const thumb = await scaleTo(source, THUMB_EDGE, THUMB_QUALITY);
    return { thumb, full };
  } finally {
    source.done();
  }
}

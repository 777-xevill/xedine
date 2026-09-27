'use client';

import type { OutboxEntry, OutboxStore } from './outbox';

/**
 * IndexedDB storage for the outbox. It survives reloads, crashes and a dead battery, which
 * localStorage would too, but IndexedDB writes are transactional and it isn't capped at ~5 MB.
 * Scoped per device so a re-paired tablet never replays another device's queue.
 */
const DB_NAME = 'xedine-pos';
const STORE = 'outbox';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('deviceId', 'deviceId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface Stored {
  id: string;
  deviceId: string;
  entry: OutboxEntry;
}

export function idbOutboxStore(deviceId: string): OutboxStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => (dbPromise ??= openDb());
  const tx = async (mode: IDBTransactionMode) =>
    (await db()).transaction(STORE, mode).objectStore(STORE);

  return {
    async all() {
      const store = await tx('readonly');
      const rows = (await done(store.index('deviceId').getAll(deviceId))) as Stored[];
      return rows.map((r) => r.entry);
    },
    async put(entry) {
      const store = await tx('readwrite');
      await done(store.put({ id: entry.id, deviceId, entry } satisfies Stored));
    },
    async remove(id) {
      const store = await tx('readwrite');
      await done(store.delete(id));
    },
  };
}

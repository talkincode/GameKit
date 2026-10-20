import { fromStored, toStored, type Project, type StoredProject } from "./project";

const DB_NAME = "gamekit";
const STORE = "projects";
/** One agent conversation per project (src/lib/adk/session.ts). */
const SESSION_STORE = "sessions";
/** Sounds the child kept from the editor, separate from any one project. */
const SOUND_STORE = "sounds";
/** One ring of local diagnostic rows (src/lib/log/journal.ts). */
const LOG_STORE = "logs";
/** The visible assistant dialogue for one project (src/lib/conversation.ts). */
const TRANSCRIPT_STORE = "transcripts";
const JOURNAL_ID = "journal";

/**
 * Schema rule: object stores and indexes need a version bump (plus a migration in
 * `onupgradeneeded`). Adding an optional field to a stored project record does
 * not: old records simply lack it, and `fromStored` tolerates that. `design`
 * (src/lib/design.ts) and `trash` (src/lib/project.ts) were added that way.
 * Version 2 added the `sessions` store for agent conversations.
 * Version 3 added the `sounds` store for editor sounds kept on this computer.
 * Version 4 added the `logs` store for the on-device diagnostic journal.
 * Version 5 added the `transcripts` store so a project's conversation survives refresh.
 */
const DB_VERSION = 5;

export type StoredKeptSound = {
  id: string;
  createdAt: number;
  bytes: Uint8Array;
  asset: unknown;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SOUND_STORE)) db.createObjectStore(SOUND_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LOG_STORE)) db.createObjectStore(LOG_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) db.createObjectStore(TRANSCRIPT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () => reject(transaction.error ?? new Error("IndexedDB transaction did not commit."));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

export async function loadProjects(): Promise<Project[]> {
  const db = await openDb();
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<StoredProject[]>);
  db.close();
  return rows.map(fromStored).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  const committed = transactionToPromise(transaction);
  try {
    await Promise.all([
      requestToPromise(transaction.objectStore(STORE).put(toStored(project))),
      committed,
    ]);
  } finally {
    db.close();
  }
}

export async function deleteStoredProject(id: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  await requestToPromise(db.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).delete(id));
  await requestToPromise(db.transaction(TRANSCRIPT_STORE, "readwrite").objectStore(TRANSCRIPT_STORE).delete(id));
  db.close();
}

/** The dialogue cards for one project. Missing row means this project has not been talked about. */
export async function loadTranscript(projectId: string): Promise<unknown[] | null> {
  const db = await openDb();
  const row = await requestToPromise(
    db.transaction(TRANSCRIPT_STORE).objectStore(TRANSCRIPT_STORE).get(projectId) as IDBRequest<{ id: string; turns?: unknown } | undefined>,
  );
  db.close();
  return Array.isArray(row?.turns) ? row.turns : null;
}

export async function saveTranscript(projectId: string, turns: unknown[]): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(TRANSCRIPT_STORE, "readwrite");
  const committed = transactionToPromise(transaction);
  try {
    await Promise.all([
      requestToPromise(transaction.objectStore(TRANSCRIPT_STORE).put({ id: projectId, turns })),
      committed,
    ]);
  } finally {
    db.close();
  }
}

/**
 * Agent conversations. One record per project, written through the same rules as
 * projects (indexedDB only, tolerant reads): rows are plain JSON.
 */
export async function loadSession(id: string): Promise<unknown | null> {
  const db = await openDb();
  const row = await requestToPromise(db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(id) as IDBRequest<unknown>);
  db.close();
  return row ?? null;
}

export async function saveSession(row: { id: string }): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).put(row));
  db.close();
}

export async function removeSession(id: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).delete(id));
  db.close();
}

/** Editor sounds kept on this computer. Missing store on an old database is created by version 3. */
export async function loadKeptSounds(): Promise<StoredKeptSound[]> {
  const db = await openDb();
  const rows = await requestToPromise(db.transaction(SOUND_STORE).objectStore(SOUND_STORE).getAll() as IDBRequest<StoredKeptSound[]>);
  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveKeptSound(row: StoredKeptSound): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(SOUND_STORE, "readwrite").objectStore(SOUND_STORE).put(row));
  db.close();
}

export async function removeKeptSound(id: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(SOUND_STORE, "readwrite").objectStore(SOUND_STORE).delete(id));
  db.close();
}

/** The on-device log ring. One row, newest first. Missing store is created by version 4. */
export async function loadJournal(): Promise<unknown[]> {
  const db = await openDb();
  const row = await requestToPromise(
    db.transaction(LOG_STORE).objectStore(LOG_STORE).get(JOURNAL_ID) as IDBRequest<{ id: string; entries?: unknown } | undefined>,
  );
  db.close();
  return Array.isArray(row?.entries) ? row.entries : [];
}

export async function saveJournal(entries: unknown[]): Promise<void> {
  const db = await openDb();
  await requestToPromise(
    db.transaction(LOG_STORE, "readwrite").objectStore(LOG_STORE).put({ id: JOURNAL_ID, entries }),
  );
  db.close();
}

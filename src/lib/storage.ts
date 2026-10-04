import { fromStored, toStored, type Project, type StoredProject } from "./project";

const DB_NAME = "gamekit";
const STORE = "projects";
/** One agent conversation per project (src/lib/adk/session.ts). */
const SESSION_STORE = "sessions";

/**
 * Schema rule: object stores and indexes need a version bump (plus a migration in
 * `onupgradeneeded`). Adding an optional field to a stored project record does
 * not: old records simply lack it, and `fromStored` tolerates that. `design`
 * (src/lib/design.ts) and `trash` (src/lib/project.ts) were added that way.
 * Version 2 added the `sessions` store for agent conversations.
 */
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" });
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
  db.close();
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

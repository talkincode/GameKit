import { fromStored, toStored, type Project, type StoredProject } from "./project";

const DB_NAME = "gamekit";
const STORE = "projects";

/**
 * Schema rule: object stores and indexes need a version bump (plus a migration in
 * `onupgradeneeded`). Adding an optional field to a stored project record does
 * not: old records simply lack it, and `fromStored` tolerates that. `design`
 * (src/lib/design.ts) was added that way.
 */
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
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

export async function loadProjects(): Promise<Project[]> {
  const db = await openDb();
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<StoredProject[]>);
  db.close();
  return rows.map(fromStored).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(toStored(project)));
  db.close();
}

export async function deleteStoredProject(id: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  db.close();
}

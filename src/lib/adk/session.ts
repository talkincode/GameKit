/**
 * One agent conversation per project, kept in IndexedDB.
 *
 * ADK owns the shape of a session (events, state, token budget); this service is
 * only the storage: opening a project loads its conversation back, so a round
 * that starts today can continue what the child and the assistant did before.
 */
import { BaseSessionService, createSession, type Event, type Session } from "@google/adk";
import { loadSession, removeSession, saveSession } from "../storage";

type StoredSession = { id: string; session: Session };

/** Events are plain data; this keeps the row JSON-safe and drops nothing else. */
function toRow(session: Session): StoredSession {
  return { id: session.id, session: JSON.parse(JSON.stringify(session)) as Session };
}

export class ProjectSessionService extends BaseSessionService {
  private readonly memory = new Map<string, Session>();

  async createSession(request: { appName: string; userId: string; sessionId?: string; state?: Record<string, unknown> }): Promise<Session> {
    const session = createSession({
      id: request.sessionId ?? crypto.randomUUID(),
      appName: request.appName,
      userId: request.userId,
      state: request.state ?? {},
      events: [],
      lastUpdateTime: Date.now(),
    });
    this.memory.set(session.id, session);
    await this.persist(session);
    return session;
  }

  async getSession(request: { appName: string; userId: string; sessionId: string }): Promise<Session | undefined> {
    const cached = this.memory.get(request.sessionId);
    if (cached) return cached;
    const row = (await loadSession(request.sessionId)) as StoredSession | null;
    if (!row?.session) return undefined;
    this.memory.set(row.session.id, row.session);
    return row.session;
  }

  async listSessions(request: { appName: string; userId: string }) {
    const sessions = [...this.memory.values()].filter((session) => session.userId === request.userId);
    return { sessions, page: 1, limit: sessions.length, totalItems: sessions.length, totalPages: 1 };
  }

  async deleteSession(request: { appName: string; userId: string; sessionId: string }): Promise<void> {
    this.memory.delete(request.sessionId);
    await removeSession(request.sessionId);
  }

  async appendEvent(request: { session: Session; event: Event }): Promise<Event> {
    const { session, event } = request;
    session.events.push(event);
    session.lastUpdateTime = Date.now();
    this.memory.set(session.id, session);
    await this.persist(session);
    return event;
  }

  private async persist(session: Session): Promise<void> {
    try {
      await saveSession(toRow(session));
    } catch {
      // A conversation that cannot be saved must never break the round; the run
      // continues in memory and the child's project is untouched.
    }
  }
}

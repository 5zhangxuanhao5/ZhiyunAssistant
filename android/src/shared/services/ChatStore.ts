import { ChatTurn } from './AiClient';
import { Course } from '../model/Timeline';
import { LocalStore } from './LocalStore';
export interface ChatSession { id: string; title: string; turns: ChatTurn[]; savedAt: number }
export class ChatStore {
  private store: LocalStore;
  private course: Course | undefined;
  constructor(store: LocalStore) { this.store = store; this.course = store.activeCourse; }
  list(): ChatSession[] { try { const sessions = JSON.parse(this.course ? this.store.cache.read('chat', this.course, 'conversations.json') : '') as ChatSession[]; return Array.isArray(sessions) ? sessions.filter((session: ChatSession) => !!session.id && Array.isArray(session.turns)).sort((a: ChatSession, b: ChatSession) => b.savedAt - a.savedAt) : []; } catch (_) { return []; } }
  save(session: ChatSession): void { if (!session.turns.length) return; const sessions = this.list().filter((item: ChatSession) => item.id !== session.id); if (this.course) this.store.cache.save('chat', this.course, 'conversations.json', JSON.stringify([session].concat(sessions))); }
  delete(id: string): void { if (this.course) this.store.cache.save('chat', this.course, 'conversations.json', JSON.stringify(this.list().filter((session: ChatSession) => session.id !== id))); }
  create(): ChatSession { return { id: 'chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), title: '新对话', turns: [], savedAt: Date.now() }; }
}

import { randomUUID } from 'node:crypto';

import { getStatePaths } from '../core/config.js';
import { readJsonFile, writeJsonFile } from '../core/state.js';

export interface ConversationStore {
  [conversationId: string]: {
    sessionId: string;
    updatedAt: string;
  };
}

async function loadConversationStore(): Promise<ConversationStore> {
  return await readJsonFile<ConversationStore>(
    getStatePaths().conversationStorePath,
    {}
  );
}

async function saveConversationStore(store: ConversationStore): Promise<void> {
  await writeJsonFile(getStatePaths().conversationStorePath, store);
}

export async function getStoredSessionId(
  conversationId: string
): Promise<string | null> {
  const store = await loadConversationStore();
  const existing = store[conversationId];

  if (existing?.sessionId) {
    existing.updatedAt = new Date().toISOString();
    await saveConversationStore(store);
    return existing.sessionId;
  }

  return null;
}

export async function createConversationSession(
  conversationId: string
): Promise<string> {
  const store = await loadConversationStore();
  const sessionId = randomUUID();
  store[conversationId] = {
    sessionId,
    updatedAt: new Date().toISOString()
  };
  await saveConversationStore(store);
  return sessionId;
}

export async function resetConversationSession(conversationId: string): Promise<void> {
  const store = await loadConversationStore();
  delete store[conversationId];
  await saveConversationStore(store);
}

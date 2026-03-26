import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

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

function buildConversationStoreKey(
  conversationId: string,
  workspaceRoot: string
): string {
  return `${resolve(workspaceRoot)}::${conversationId}`;
}

export async function getStoredSessionId(
  conversationId: string,
  workspaceRoot: string
): Promise<string | null> {
  const store = await loadConversationStore();
  const existing = store[buildConversationStoreKey(conversationId, workspaceRoot)];

  if (existing?.sessionId) {
    existing.updatedAt = new Date().toISOString();
    await saveConversationStore(store);
    return existing.sessionId;
  }

  return null;
}

export async function createConversationSession(
  conversationId: string,
  workspaceRoot: string
): Promise<string> {
  const store = await loadConversationStore();
  const sessionId = randomUUID();
  store[buildConversationStoreKey(conversationId, workspaceRoot)] = {
    sessionId,
    updatedAt: new Date().toISOString()
  };
  await saveConversationStore(store);
  return sessionId;
}

export async function resetConversationSession(
  conversationId: string,
  workspaceRoot: string
): Promise<void> {
  const store = await loadConversationStore();
  delete store[buildConversationStoreKey(conversationId, workspaceRoot)];
  await saveConversationStore(store);
}

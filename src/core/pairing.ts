import { getStatePaths } from './config.js';
import { readJsonFile, writeJsonFile } from './state.js';

interface PairingState {
  pairedUserIds: string[];
  pairedAt?: string;
  lastLoginUserId?: string;
}

const EMPTY_PAIRING_STATE: PairingState = {
  pairedUserIds: []
};

export async function loadPairingState(): Promise<PairingState> {
  const paths = getStatePaths();
  return await readJsonFile<PairingState>(paths.pairingPath, EMPTY_PAIRING_STATE);
}

export async function getPairedUserIds(): Promise<string[]> {
  const state = await loadPairingState();
  return state.pairedUserIds;
}

export async function addPairedUser(userId: string): Promise<void> {
  const trimmed = userId.trim();
  if (!trimmed) {
    return;
  }

  const paths = getStatePaths();
  const state = await loadPairingState();

  if (!state.pairedUserIds.includes(trimmed)) {
    state.pairedUserIds.push(trimmed);
    state.pairedAt = new Date().toISOString();
  }

  state.lastLoginUserId = trimmed;
  await writeJsonFile(paths.pairingPath, state);
}

export async function isPairedUser(userId: string): Promise<boolean> {
  const state = await loadPairingState();
  return state.pairedUserIds.includes(userId.trim());
}

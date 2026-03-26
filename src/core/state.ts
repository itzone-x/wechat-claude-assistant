import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T
): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(
  filePath: string,
  value: T
): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

export async function readTextFile(
  filePath: string,
  fallback = ''
): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return fallback;
  }
}

export async function writeTextFile(
  filePath: string,
  value: string
): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, value, 'utf-8');
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {}
}

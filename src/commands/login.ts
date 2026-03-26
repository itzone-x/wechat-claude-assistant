import { confirm } from '../ui/prompts.js';
import { loadSavedAccount, performLogin } from '../core/login-qr.js';

export async function runLoginCommand(): Promise<void> {
  const existing = await loadSavedAccount();

  if (existing) {
    const redo = await confirm(
      `当前已连接微信${existing.userId ? `（${existing.userId}）` : ''}，是否重新登录？`,
      false
    );

    if (!redo) {
      console.log('保留当前连接，不做变更。');
      return;
    }
  }

  await performLogin();
}

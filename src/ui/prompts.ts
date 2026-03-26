import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

function canPrompt(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function isYes(answer: string): boolean {
  return ['y', 'yes', '1', '是', '好', 'ok'].includes(answer);
}

function isNo(answer: string): boolean {
  return ['n', 'no', '0', '否'].includes(answer);
}

async function withPrompt<T>(fn: (rl: ReturnType<typeof createInterface>) => Promise<T>): Promise<T> {
  const rl = createInterface({ input, output });
  try {
    return await fn(rl);
  } finally {
    rl.close();
  }
}

export async function confirm(
  question: string,
  defaultYes = true
): Promise<boolean> {
  if (!canPrompt()) {
    return defaultYes;
  }

  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const answer = (await withPrompt((rl) => rl.question(question + suffix))).trim().toLowerCase();

  if (!answer) {
    return defaultYes;
  }

  if (isYes(answer)) {
    return true;
  }

  if (isNo(answer)) {
    return false;
  }

  return defaultYes;
}

export async function ask(
  question: string,
  defaultValue = ''
): Promise<string> {
  if (!canPrompt()) {
    return defaultValue;
  }

  const suffix = defaultValue ? ` (${defaultValue}) ` : ' ';
  const answer = (await withPrompt((rl) => rl.question(question + suffix))).trim();
  return answer || defaultValue;
}

export async function choose<T extends string>(
  question: string,
  options: ChoiceOption<T>[],
  defaultValue: T
): Promise<T> {
  if (!canPrompt()) {
    return defaultValue;
  }

  console.log(question);
  options.forEach((option, index) => {
    const selected = option.value === defaultValue ? ' (默认)' : '';
    const description = option.description ? ` - ${option.description}` : '';
    console.log(`  ${index + 1}. ${option.label}${selected}${description}`);
  });

  while (true) {
    const answer = await ask('请输入序号，直接回车表示使用默认值', '');
    if (!answer) {
      return defaultValue;
    }

    const index = Number.parseInt(answer, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
      return options[index - 1].value;
    }

    console.log(`输入无效，请输入 1 到 ${options.length} 之间的数字。`);
  }
}

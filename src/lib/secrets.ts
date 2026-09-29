import { readFileSync } from 'fs';

export function getSecret(name: string, fallback: string = ''): string {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      return fallback;
    }
  }

  const value = process.env[name];
  if (typeof value === 'string') {
    return value;
  }

  return fallback;
}

import { HandlerPermission } from '@/lib/plugin.js';
import fs, { PathLike } from 'fs';
import { access } from 'fs/promises';

/**
 * Check if a file can be accessed with the given permission
 */
export async function can_access(path: PathLike, perm: number = fs.constants.R_OK) {
  try {
    await access(path, perm);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Make an action RAII, note that its result should be `using`ed
 *
 * It can't be merged with [`mkAsyncRaii`], due to TS restrictions.
 */
export function mkRaii(fn: () => void): Disposable {
  return { [Symbol.dispose]: fn };
}
/**
 * Make an async action RAII, note that its result should be `await using`ed
 *
 * It can't be merged with [`mkRaii`], due to TS restrictions.
 */
export function mkAsyncRaii(fn: () => Promise<void>): AsyncDisposable {
  return { [Symbol.asyncDispose]: fn };
}

export function escape(str: string): string {
  return str.replaceAll(
    /[\n\t'"]/g,
    (s) => ({ '\n': '\\n', '\t': '\\t', "'": "\\'", '"': '\\"' })[s] ?? `\\${s}`
  );
}

export function compare_perm(a: HandlerPermission, b: HandlerPermission) {
  if (a.kind === 'custom' && b.kind === 'custom') return a.lv < b.lv ? -1 : a.lv === b.lv ? 0 : 1;
  else {
    const tonum = { anyone: -1, custom: 0, admin: 1 };
    const an = tonum[a.kind];
    const bn = tonum[b.kind];
    return an < bn ? -1 : an === bn ? 0 : 1;
  }
}

export const ensure_extend =
  <T>() =>
  <U extends T>(a: U) =>
    a;
export function mkproto<T>(): () => T {
  return () => {
    throw new Error('mkproto should not be invoked!');
  };
}
export const ensure_exhaust = (v: never) => v;

export type MaybePromiseLike<T> = T | PromiseLike<T>;

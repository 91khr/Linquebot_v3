/* eslint no-console: "off"
   ---
 * Loggers requires console to implement...
 */

import chalk from 'chalk';
import { I18nEngine, global_i18n } from './i18n.js';
import { mkRaii } from './utils.js';

export type LogKinds = 'internal-error' | 'error' | 'warn' | 'info' | 'debug';
type SingledKinds = Exclude<LogKinds, 'internal-error'>;

const region_stack: string[] = [];

export class Logger {
  private i18n: I18nEngine;
  level: LogKinds;

  constructor(i18n: I18nEngine, lv: LogKinds = 'info') {
    this.i18n = i18n;
    this.level = lv;
  }
  clone() {
    return new Logger(this.i18n.clone(), this.level);
  }

  private dispatch_kind(kind: SingledKinds) {
    const kindprio = {
      'internal-error': 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
    };
    const printing_fn = {
      error: console.error,
      warn: console.warn,
      info: console.log,
      debug: console.debug,
    };
    return {
      print: kindprio[kind] <= kindprio[this.level] ? printing_fn[kind] : () => void 0,
      color: {
        error: chalk.red,
        warn: chalk.yellow,
        info: (a: string) => a,
        debug: chalk.blue,
      }[kind],
    };
  }

  /**
   * Print a log message with the given kind.
   * Used for template literals.
   */
  tmpl(kind: LogKinds = 'info'): (ss: TemplateStringsArray, ...vs: unknown[]) => void {
    return (ss, ...vs) => this.raw_put(this.i18n.tmpl(ss, ...vs), kind);
  }
  /**
   * Print a log message with the given kind.
   */
  put(msg: string, kind: LogKinds = 'info') {
    this.raw_put(this.i18n.tr(msg), kind);
  }
  /**
   * Print a log message with the given kind, not translated.
   */
  raw_put(msg: string, kind: LogKinds = 'info') {
    if (kind === 'internal-error') {
      console.trace(`(Internal Error) ${msg}`);
      return;
    }
    const { print, color } = this.dispatch_kind(kind);
    print(region_stack.join('') + color(msg));
  }

  region_tmpl(
    kind: SingledKinds = 'info'
  ): (ss: TemplateStringsArray, ...vs: unknown[]) => Disposable {
    return (ss, ...vs) => this.raw_region(this.i18n.tmpl(ss, ...vs), kind);
  }
  begin_region_tmpl(
    kind: SingledKinds = 'info'
  ): (ss: TemplateStringsArray, ...vs: unknown[]) => void {
    return (ss, ...vs) => this.raw_begin_region(this.i18n.tmpl(ss, ...vs), kind);
  }
  end_region_tmpl(
    kind: SingledKinds = 'info'
  ): (ss: TemplateStringsArray, ...vs: unknown[]) => void {
    return (ss, ...vs) => this.raw_end_region(this.i18n.tmpl(ss, ...vs), kind);
  }
  region(msg: string, kind: SingledKinds = 'info') {
    return this.raw_region(this.i18n.tr(msg), kind);
  }
  begin_region(msg: string, kind: SingledKinds = 'info') {
    return this.raw_begin_region(this.i18n.tr(msg), kind);
  }
  end_region(msg: string, kind: SingledKinds = 'info') {
    return this.raw_end_region(this.i18n.tr(msg), kind);
  }
  raw_region(msg: string, kind: SingledKinds = 'info'): Disposable {
    this.raw_begin_region(msg, kind);
    return mkRaii(() => this.raw_end_region(undefined, kind));
  }
  raw_begin_region(msg: string, kind: SingledKinds = 'info') {
    const { print, color } = this.dispatch_kind(kind);
    print(region_stack.join('') + color('┌ ' + msg));
    region_stack.push(color('│ '));
  }
  raw_end_region(msg?: string, kind: SingledKinds = 'info') {
    region_stack.pop();
    if (msg) {
      const { print, color } = this.dispatch_kind(kind);
      print(region_stack.join('') + color('└ ' + msg));
    }
  }

  header_tmpl(kind: SingledKinds = 'info'): (ss: TemplateStringsArray, ...vs: unknown[]) => void {
    return (ss, ...vs) => this.raw_header(this.i18n.tmpl(ss, ...vs), kind);
  }
  header(msg: string, kind: SingledKinds = 'info') {
    this.raw_header(this.i18n.tr(msg), kind);
  }
  raw_header(msg: string, kind: SingledKinds = 'info') {
    const { print, color } = this.dispatch_kind(kind);
    print(color(msg));
    print(color('-'.repeat(msg.replaceAll(/\p{sc=Han}/gu, '  ').length)));
  }
}

export const global_log = new Logger(global_i18n);

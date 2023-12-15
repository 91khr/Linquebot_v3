import { readFile } from 'fs/promises';
import { inspect } from 'util';

export class I18nEngine {
  /**
   * Make an I18nEngine, should be used as constructor, since normal constructors can't be async.
   *
   * If locale is 'raw', no translations would be made.
   */
  static async mk(locale: string): Promise<I18nEngine> {
    const self = new I18nEngine();
    if (locale === 'raw') self.translation = new Proxy({}, { get: (_, p) => p.toString() });
    else await self.set_locale(locale);
    return self;
  }

  private translation: { [k: string]: string | undefined } = {};
  private constructor() {}

  tr(str: string): string {
    return this.translation[str] ?? `(translation missing: ${str})`;
  }

  tmpl(ss: TemplateStringsArray, ...orig_vs: unknown[]): string {
    const vs = orig_vs.map((o) => (typeof o === 'string' ? o : inspect(o)));
    const query = ss
      .map((s) => s.replaceAll('%', '%%'))
      .reduce((tot, cur, i) => `${tot}%${i}${cur}`);
    const repl = this.translation[query];
    if (!repl) return `(translation missing: ${query})`;
    return repl.replaceAll(/%(\d+|%)/g, (_, i) => (i === '%' ? '%' : vs[Number(i) - 1]));
  }

  async set_locale(locale: string) {
    this.translation = JSON.parse((await readFile(`../locales/${locale}.json`)).toString()) as {
      [k: string]: string;
    };
  }

  clone(): I18nEngine {
    const res = new I18nEngine();
    res.translation = this.translation;
    return res;
  }
}

export const global_i18n = await I18nEngine.mk('raw');

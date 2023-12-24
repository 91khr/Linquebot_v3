import { mkdir, open, readFile } from 'fs/promises';
import { inspect } from 'util';
import { escape } from './utils.js';
import jsYaml from 'js-yaml';

type TransType = { [k: string]: string | undefined };
export class I18nEngine {
  /**
   * Make an I18nEngine, should be used as constructor, since normal constructors can't be async.
   *
   * If locale is 'raw', no translations would be made.
   */
  static async mk(locale: string): Promise<I18nEngine> {
    const self = new I18nEngine();
    await self.set_locale(locale);
    return self;
  }

  private translation: TransType = {};
  private raw_logger: { log: (s: string) => void; finish: () => void } = { log() {}, finish() {} };
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
    let tr;
    if (locale === 'raw') {
      tr = {};
      await mkdir('locales', { recursive: true });
      const text = jsYaml.load(await readFile('locales/raw.yaml', { encoding: 'utf8' })) as object;
      const raw_logger = {
        file: await open('locales/raw.yaml', 'a'),
        text: new Set(Object.keys(text)),
        prom: Promise.resolve(),
        log(s: string) {
          if (this.text.has(s)) return;
          this.text.add(s);
          this.prom = this.prom.then(() => this.file.appendFile(`"${escape(s)}": undefined\n`));
        },
        finish() {
          void this.prom.then(() => this.file.close());
        },
      };
      this.raw_logger = raw_logger;
    } else
      tr = JSON.parse((await readFile(`locales/${locale}.json`)).toString()) as {
        [k: string]: string;
      };
    this.translation = new Proxy(tr, {
      get: (t, p) => {
        if (p in t) return t[p.toString()];
        const s = p.toString();
        if (locale === 'raw') this.raw_logger.log(s);
        return s;
      },
    });
  }

  clone(): I18nEngine {
    const res = new I18nEngine();
    res.translation = this.translation;
    return res;
  }
}

export const global_i18n = await I18nEngine.mk('raw');

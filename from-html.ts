import { URL } from 'node:url';
import * as parse5 from 'parse5';
import * as TreeAdapter from '../../node_modules/parse5/dist/tree-adapters/default.js';

const treeAdapter = TreeAdapter.defaultTreeAdapter;

const urlRegex = /^https?:\/\/[\w\/:%#@$&?!()\[\]~.,=+\-]+/;
const urlRegexFull = /^https?:\/\/[\w\/:%#@$&?!()\[\]~.,=+\-]+$/;

export function fromHtml(html: string, hashtagNames?: string[]): string {
  // some AP servers like Pixelfed use br tags as well as newlines
  html = html.replace(/<br\s?\/?>\r?\n/gi, '\n');
  const dom = parse5.parseFragment(html);

  const driver: { [k in TreeAdapter.Node['tag']]: (n: TreeAdapter.Node) => string } = ((
    ...xs: [string[] | string, (n: TreeAdapter.Node) => string][]
  ) =>
    Object.fromEntries(
      xs.flatMap(([n, f]) => (typeof n === 'string' ? [n] : n).map((m) => [m, f]))
    ))(
    ['br', () => '\n'],
    [
      'a',
      (node) => {
        const txt = getText(node);
        const rel = node.attrs.find((x) => x.name === 'rel');
        const href = node.attrs.find((x) => x.name === 'href');

        // ハッシュタグ
        if (
          hashtagNames &&
          href &&
          hashtagNames.map((x) => x.toLowerCase()).includes(txt.toLowerCase())
        ) {
          return txt;
          // メンション
        } else if (txt.startsWith('@') && !rel?.value.match(/^me /)) {
          const part = txt.split('@');

          if (part.length === 2 && href) {
            //#region ホスト名部分が省略されているので復元する
            const acct = `${txt}@${new URL(href.value).hostname}`;
            return acct;
            //#endregion
          } else if (part.length === 3) {
            return txt;
          }
          // その他
        } else {
          if (!(href || txt)) {
            return '';
          }
          if (!href) {
            return txt;
          }
          if (!txt || txt === href.value) {
            // #6383: Missing text node
            if (href.value.match(urlRegexFull)) {
              return href.value;
            } else {
              return `<${href.value}>`;
            }
          }
          if (href.value.match(urlRegex) && !href.value.match(urlRegexFull)) {
            return `[${txt}](<${href.value}>)`; // #6846
          } else {
            return `[${txt}](${href.value})`;
          }
        }
      },
    ],

    ['h1', (node) => ['\n\n', '**$[x2 ', iterate(node.childNodes), ' ]**'].join('')],

    [['h2', 'h3'], (node) => ['\n\n', '**', iterate(node.childNodes), '**'].join('')],

    [['b', 'strong'], (node) => ['**', iterate(node.childNodes), '**'].join('')],

    ['small', (node) => ['<small>', iterate(node.childNodes), '</small>'].join('')],

    [['s', 'del'], (node) => ['~~', iterate(node.childNodes), '~~'].join('')],

    [['i', 'em'], (node) => ['<i>', iterate(node.childNodes), '</i>'].join('')],

    // block code (<pre><code>)
    [
      'pre',
      (node) => {
        if (node.childNodes.length === 1 && node.childNodes[0].nodeName === 'code') {
          return ['\n```\n', getText(node.childNodes[0]), '\n```\n'].join('');
        } else {
          return iterate(node.childNodes);
        }
      },
    ],

    // inline code (<code>)
    ['code', (node) => ['`', iterate(node.childNodes), '`'].join('')],

    [
      'blockquote',
      (node) => {
        const t = getText(node);
        if (t) return ['\n> ', t.split('\n').join('\n> ')].join('');
        else return '';
      },
    ],

    [['p', 'h4', 'h5', 'h6'], (node) => ['\n\n', iterate(node.childNodes)].join('')],

    ['li', (node) => ['\n', '- ', iterate(node.childNodes)].join('')],

    // other block elements
    [
      ['div', 'header', 'footer', 'article', 'dt', 'dd'],
      (node) => ['\n', iterate(node.childNodes)].join(''),
    ]
  );

  const default_driver = (node) => {
    if (treeAdapter.isTextNode(node)) return node.value;
    else if (!treeAdapter.isElementNode(node)) return '';
    else return iterate(node.childNodes);
  };
  function iterate(nodes: TreeAdapter.ChildNode[]) {
    return nodes.map((n) => (driver[n.nodeName] ?? default_driver)(n)).join('');
  }

  function getText(node: TreeAdapter.Node): string {
    if (treeAdapter.isTextNode(node)) return node.value;
    if (!treeAdapter.isElementNode(node)) return '';
    if (node.nodeName === 'br') return '\n';

    if (node.childNodes) {
      return node.childNodes.map((n) => getText(n)).join('');
    }

    return '';
  }

  return iterate(dom).trim();
}

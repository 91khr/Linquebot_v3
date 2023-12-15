import { I18nEngine } from '../src/lib/i18n.js';

test('can map', async () => {
  const i18n = await I18nEngine.mk('raw');
  expect(i18n.tr('test test')).toBe('test test');
  expect(i18n.tmpl`expr ${1 + 2} = ${2 + 1}`).toBe('expr 3 = 3');
  // @ts-expect-error It's private (!)
  i18n.translation = {
    test1: 'test2',
    'a %1 b %2': '%2 to %1',
  };
  expect(i18n.tr('test1')).toBe('test2');
  expect(i18n.tmpl`a ${1 + 2} b ${2 + 1}`).toBe('3 to 3');
});

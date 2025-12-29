/**
 * Languages Loader
 */

import { merge, loadOptionalYaml } from './util.js';

/** @typedef {import('./index.d.ts').ILocale} ILocale */

const languages = [
	'ar-SA',
	'ca-ES',
	'cs-CZ',
	'da-DK',
	'de-DE',
	'en-US',
	'es-ES',
	'fr-FR',
	'id-ID',
	'it-IT',
	'ja-JP',
	'ja-KS',
	'kab-KAB',
	'kn-IN',
	'ko-KR',
	'nl-NL',
	'no-NO',
	'pl-PL',
	'pt-PT',
	'ru-RU',
	'sk-SK',
	'th-TH',
	'ug-CN',
	'uk-UA',
	'vi-VN',
	'zh-CN',
	'zh-TW',
];

const primaries = {
	'en': 'US',
	'ja': 'JP',
	'zh': 'CN',
};

export function build() {
	/** @type {Record<string, ILocale>} */
	const sharkeyLocales = languages.reduce((a, c) => (a[c] = loadOptionalYaml(`../sharkey-locales/${c}.yml`), a), {});
		/** @type {Record<string, ILocale>} */
	const misskeyLocales = languages.reduce((a, c) => (a[c] = loadOptionalYaml(`${c}.yml`), a), {});

	// merge sharkey and misskey's locales. the second argument (sharkey) overwrites the first argument (misskey).
  const locales = merge(misskeyLocales, sharkeyLocales);

	/**
	 * 空文字列が入ることがあり、フォールバックが動作しなくなるのでプロパティごと消す
	 * @template {Record<string, ILocale> | ILocale} T
	 * @param {T} obj
	 * @returns {T}
	 */
	const removeEmpty = (obj) => {
		for (const [k, v] of Object.entries(obj)) {
			if (v === '') {
				delete obj[k];
			} else if (typeof v === 'object') {
				removeEmpty(v);
			}
		}
		return obj;
	};
	removeEmpty(locales);

	return Object.entries(locales)
		.reduce((a, [k, v]) => (a[k] = (() => {
			const [lang] = k.split('-');
			switch (k) {
				case 'ja-JP': return v;
				case 'ja-KS':
				case 'en-US': return merge(locales['ja-JP'], v);
				default: return merge(
					locales['ja-JP'],
					locales['en-US'],
					locales[`${lang}-${primaries[lang]}`] ?? {},
					v
				);
			}
		})(), a), {});
}

export default build();

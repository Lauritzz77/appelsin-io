export const LOCALES = ['da', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function localeFromPath(pathname: string): Locale {
	const firstSegment = pathname.split('/').filter(Boolean)[0]
	return firstSegment === 'en' ? 'en' : 'da'
}

export function localisePath(pathname: string, locale: Locale): string {
	const parts = pathname.split('/').filter(Boolean)
	const currentLocale = isLocale(parts[0]) ? parts[0] : null
	const unprefixed = currentLocale ? parts.slice(1) : parts
	const suffix = unprefixed.length > 0 ? `/${unprefixed.join('/')}` : '/'
	return locale === 'da' ? suffix : `/en${suffix === '/' ? '' : suffix}`
}

export const commonText = {
	en: {
		languageName: 'English',
		switchLanguage: 'Dansk',
	},
	da: {
		languageName: 'Dansk',
		switchLanguage: 'English',
	},
} satisfies Record<Locale, Record<string, string>>

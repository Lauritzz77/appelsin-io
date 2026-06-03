import type { Locale } from './i18n'

// The Danish files are the canonical shape: importing them explicitly gives `astro
// check` concrete types, so the English mirror can be structurally compared against
// them (see content.assert.ts). Add one import + `da` entry per namespace as the
// cms/ folders grow.
import daCommon from '@cms/da/common.json'
import daHome from '@cms/da/home.json'
import daLogin from '@cms/da/login.json'
import daGuestEntry from '@cms/da/guest-entry.json'
import daLegal from '@cms/da/legal.json'
import daDashboard from '@cms/da/dashboard.json'
import daBilling from '@cms/da/billing.json'
import daEventNew from '@cms/da/event-new.json'
import daGuestUpload from '@cms/da/guest-upload.json'
import daStyleEditor from '@cms/da/style-editor.json'
import daDisplay from '@cms/da/display.json'
import daGallery from '@cms/da/gallery.json'
import daEventDetail from '@cms/da/event-detail.json'

const da = {
	common: daCommon,
	home: daHome,
	login: daLogin,
	'guest-entry': daGuestEntry,
	legal: daLegal,
	dashboard: daDashboard,
	billing: daBilling,
	'event-new': daEventNew,
	'guest-upload': daGuestUpload,
	'style-editor': daStyleEditor,
	display: daDisplay,
	gallery: daGallery,
	'event-detail': daEventDetail,
} as const

export type Namespace = keyof typeof da
export type Content<N extends Namespace> = (typeof da)[N]

// Every locale's JSON, discovered and inlined by Vite at build time (no runtime fs —
// safe on the Cloudflare Workers adapter). Keyed by path, e.g. '/cms/en/common.json'.
const all = import.meta.glob<{ default: unknown }>('/cms/**/*.json', { eager: true })

/**
 * Localised content for a namespace. The return type is pinned to the Danish shape,
 * so every call site is type-checked against it; English falls back to Danish if its
 * file is somehow missing at runtime.
 */
export function getContent<N extends Namespace>(locale: Locale, ns: N): Content<N> {
	if (locale === 'da') return da[ns]
	const mod = all[`/cms/${locale}/${ns}.json`] as { default: unknown } | undefined
	return (mod?.default ?? da[ns]) as Content<N>
}

/** Minimal placeholder interpolation (no ICU): fill('…koden {code}.', { code }). */
export function fill(template: string, vars: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : `{${key}}`))
}

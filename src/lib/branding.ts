// Per-event styling for the paid-tier photo wall (/display/[code]).
// Stored as JSON in `events.branding_json`; default applied when the column
// is null or unparseable. Free-tier events don't read this — they render
// through PhotoCollage with locked appelsin branding instead.

export type DensityId = 'small' | 'medium' | 'large'
export type FontId = 'serif' | 'handwriting' | 'display'

export type EventBranding = {
	background: string
	text: string
	density: DensityId
	font: FontId
	titleOverlay: {
		enabled: boolean
		line1: string
		line2: string
	}
}

// Old theme IDs that may still be in `events.branding_json` from before the
// background/text picker landed. parseBranding maps these back to colours so
// existing events keep the look they had.
const LEGACY_THEME_COLORS: Record<string, { background: string; text: string }> = {
	airy: { background: '#faf6f1', text: '#2a2a2a' },
	folk: { background: '#ece3d4', text: '#3b2a1d' },
	editorial: { background: '#0f0f10', text: '#f4f1eb' },
}

export type FontPreset = {
	id: FontId
	label: string
	// CSS font-family value. First name is the Google Font we load in
	// Layout.astro; the rest are system fallbacks while the web font is
	// fetching (or if the user is offline).
	family: string
	// Per-font tweaks for the title overlay headline. Bebas Neue ships only
	// uppercase, so we force text-transform; Caveat is informal so we keep
	// a normal weight; Playfair Display reads best at medium weight.
	headlineWeight: number
	headlineTransform: 'none' | 'uppercase'
	headlineTracking: string
}

export const FONTS: Record<FontId, FontPreset> = {
	serif: {
		id: 'serif',
		label: 'Serif',
		family: '"Playfair Display", "Hoefler Text", Cambria, Georgia, serif',
		headlineWeight: 500,
		headlineTransform: 'none',
		headlineTracking: 'normal',
	},
	handwriting: {
		id: 'handwriting',
		label: 'Handwriting',
		family: '"Caveat", "Brush Script MT", "Comic Sans MS", cursive',
		headlineWeight: 600,
		headlineTransform: 'none',
		headlineTracking: 'normal',
	},
	display: {
		id: 'display',
		label: 'Display',
		family: '"Bebas Neue", Impact, "Arial Narrow", sans-serif',
		headlineWeight: 400,
		headlineTransform: 'uppercase',
		headlineTracking: '0.04em',
	},
}

export const FONT_IDS = Object.keys(FONTS) as FontId[]

export type Lane = { leftVw: number; widthVw: number }

export type DensityPreset = {
	id: DensityId
	label: string
	lanes: readonly Lane[]
	// Editor preview only — Tailwind grid classes for the static themed
	// preview tile. Spelled out so Tailwind v4's scanner includes them.
	previewGridClass: string
}

export const DENSITIES: Record<DensityId, DensityPreset> = {
	small: {
		id: 'small',
		label: 'Small',
		lanes: [
			{ leftVw: 1,  widthVw: 14 },
			{ leftVw: 16, widthVw: 16 },
			{ leftVw: 33, widthVw: 14 },
			{ leftVw: 48, widthVw: 17 },
			{ leftVw: 66, widthVw: 14 },
			{ leftVw: 81, widthVw: 18 },
		],
		previewGridClass: 'grid-cols-4 gap-1 md:grid-cols-6 lg:grid-cols-8',
	},
	medium: {
		id: 'medium',
		label: 'Medium',
		lanes: [
			{ leftVw: 1,  widthVw: 18 },
			{ leftVw: 20, widthVw: 28 },
			{ leftVw: 49, widthVw: 22 },
			{ leftVw: 72, widthVw: 27 },
		],
		previewGridClass: 'grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5',
	},
	large: {
		id: 'large',
		label: 'Large',
		lanes: [
			{ leftVw: 1,  widthVw: 30 },
			{ leftVw: 32, widthVw: 34 },
			{ leftVw: 67, widthVw: 32 },
		],
		previewGridClass: 'grid-cols-2 gap-5 md:grid-cols-3',
	},
}

export const DENSITY_IDS = Object.keys(DENSITIES) as DensityId[]

export const DEFAULT_BRANDING: EventBranding = {
	background: '#0f0f10',
	text: '#f4f1eb',
	density: 'medium',
	font: 'serif',
	titleOverlay: { enabled: false, line1: '', line2: '' },
}

// Parse JSON from `events.branding_json` defensively — any malformed or
// missing field falls back to the default. Never throws.
export function parseBranding(raw: string | null | undefined): EventBranding {
	if (!raw) return DEFAULT_BRANDING
	try {
		const parsed = JSON.parse(raw) as Partial<EventBranding> & {
			theme?: unknown
			titleOverlay?: Partial<EventBranding['titleOverlay']>
		}
		const legacy =
			typeof parsed.theme === 'string' ? LEGACY_THEME_COLORS[parsed.theme] : undefined
		return {
			background: isHexColor(parsed.background)
				? parsed.background
				: legacy?.background ?? DEFAULT_BRANDING.background,
			text: isHexColor(parsed.text)
				? parsed.text
				: legacy?.text ?? DEFAULT_BRANDING.text,
			density: isDensityId(parsed.density) ? parsed.density : DEFAULT_BRANDING.density,
			font: isFontId(parsed.font) ? parsed.font : DEFAULT_BRANDING.font,
			titleOverlay: {
				enabled: Boolean(parsed.titleOverlay?.enabled),
				line1: String(parsed.titleOverlay?.line1 ?? '').slice(0, 80),
				line2: String(parsed.titleOverlay?.line2 ?? '').slice(0, 80),
			},
		}
	} catch {
		return DEFAULT_BRANDING
	}
}

export function isHexColor(value: unknown): value is string {
	return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

export function isDensityId(value: unknown): value is DensityId {
	return typeof value === 'string' && value in DENSITIES
}

export function isFontId(value: unknown): value is FontId {
	return typeof value === 'string' && value in FONTS
}

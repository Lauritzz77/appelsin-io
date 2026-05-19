// Per-event styling for the paid-tier photo wall (/display/[code]).
// Stored as JSON in `events.branding_json`; default applied when the column
// is null or unparseable. Free-tier events don't read this — they render
// through PhotoCollage with locked appelsin branding instead.

export type ThemeId = 'airy' | 'folk' | 'editorial'
export type DensityId = 'small' | 'medium' | 'large'

export type EventBranding = {
	theme: ThemeId
	density: DensityId
	titleOverlay: {
		enabled: boolean
		line1: string
		line2: string
	}
}

export type ThemePreset = {
	id: ThemeId
	label: string
	background: string
	text: string
	accent: string
	headingFont: string
	swatches: string[]
}

export const THEMES: Record<ThemeId, ThemePreset> = {
	airy: {
		id: 'airy',
		label: 'Airy',
		background: '#faf6f1',
		text: '#2a2a2a',
		accent: '#c8a96a',
		headingFont: '"Cormorant Garamond", "Hoefler Text", Cambria, Georgia, serif',
		swatches: ['#faf6f1', '#e9e2d6', '#c8a96a', '#7b6a4a', '#2a2a2a'],
	},
	folk: {
		id: 'folk',
		label: 'Folk',
		background: '#ece3d4',
		text: '#3b2a1d',
		accent: '#8a5a3b',
		headingFont: '"Caveat", "Brush Script MT", "Comic Sans MS", cursive',
		swatches: ['#ece3d4', '#cdb89a', '#8a5a3b', '#5a3a26', '#3b2a1d'],
	},
	editorial: {
		id: 'editorial',
		label: 'Editorial',
		background: '#0f0f10',
		text: '#f4f1eb',
		accent: '#d4af37',
		headingFont: '"Inter", system-ui, -apple-system, "Helvetica Neue", sans-serif',
		swatches: ['#0f0f10', '#26252a', '#5b554b', '#d4af37', '#f4f1eb'],
	},
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

export type DensityPreset = {
	id: DensityId
	label: string
	cols: number
	gap: string
}

// Column counts target a 16:9 display at 1080p/4K — small fits ~60 tiles
// without scrolling, large fits ~12 hero shots.
export const DENSITIES: Record<DensityId, DensityPreset> = {
	small: { id: 'small', label: 'Small', cols: 8, gap: '0.25rem' },
	medium: { id: 'medium', label: 'Medium', cols: 5, gap: '0.75rem' },
	large: { id: 'large', label: 'Large', cols: 3, gap: '1.5rem' },
}

export const DENSITY_IDS = Object.keys(DENSITIES) as DensityId[]

export const DEFAULT_BRANDING: EventBranding = {
	theme: 'editorial',
	density: 'medium',
	titleOverlay: { enabled: false, line1: '', line2: '' },
}

// Parse JSON from `events.branding_json` defensively — any malformed or
// missing field falls back to the default. Never throws.
export function parseBranding(raw: string | null | undefined): EventBranding {
	if (!raw) return DEFAULT_BRANDING
	try {
		const parsed = JSON.parse(raw) as Partial<EventBranding> & {
			titleOverlay?: Partial<EventBranding['titleOverlay']>
		}
		return {
			theme: isThemeId(parsed.theme) ? parsed.theme : DEFAULT_BRANDING.theme,
			density: isDensityId(parsed.density) ? parsed.density : DEFAULT_BRANDING.density,
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

export function isThemeId(value: unknown): value is ThemeId {
	return typeof value === 'string' && value in THEMES
}

export function isDensityId(value: unknown): value is DensityId {
	return typeof value === 'string' && value in DENSITIES
}

// Build the CSS variable bag that PhotoWall reads. Kept here so the editor
// and the live wall apply identical styles from identical inputs.
export function brandingToCssVars(branding: EventBranding): Record<string, string> {
	const theme = THEMES[branding.theme]
	const density = DENSITIES[branding.density]
	return {
		'--wall-bg': theme.background,
		'--wall-text': theme.text,
		'--wall-accent': theme.accent,
		'--wall-heading-font': theme.headingFont,
		'--wall-cols': String(density.cols),
		'--wall-gap': density.gap,
	}
}

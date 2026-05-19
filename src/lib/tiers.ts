// Single source of truth for the three event tiers. The homepage cards, the
// new-event form, the activation / checkout endpoints, the retention cron and
// (later) the upload cap + watermark all read from here.

export const TIERS = {
	free: {
		label: 'Free',
		priceCents: 0,
		currency: 'eur',
		retentionDays: 7,
		photoCap: 100,
		watermark: true,
	},
	basic: {
		label: 'Basic',
		priceCents: 4900,
		currency: 'eur',
		retentionDays: 30,
		photoCap: 500,
		watermark: false,
	},
	gold: {
		label: 'Gold',
		priceCents: 9900,
		currency: 'eur',
		retentionDays: 90,
		photoCap: 2000,
		watermark: false,
	},
} as const

export type Tier = keyof typeof TIERS
export const TIER_IDS = Object.keys(TIERS) as Tier[]

export function isTier(value: unknown): value is Tier {
	return typeof value === 'string' && value in TIERS
}

export function formatPrice(tier: Tier): string {
	const { priceCents, currency } = TIERS[tier]
	if (priceCents === 0) return 'Free'
	const amount = priceCents / 100
	return new Intl.NumberFormat('en-IE', {
		style: 'currency',
		currency: currency.toUpperCase(),
		maximumFractionDigits: 0,
	}).format(amount)
}

// Single source of truth for the three event tiers. The homepage cards, the
// new-event form, the activation / checkout endpoints, the retention cron and
// (later) the upload cap + watermark all read from here.

export const TIERS = {
	free: {
		label: 'Free',
		priceCents: 0,
		currency: 'eur',
		prices: {
			da: { priceCents: 0, currency: 'dkk' },
			en: { priceCents: 0, currency: 'eur' },
		},
		retentionDays: 7,
		photoCap: 20,
		watermark: true,
	},
	basic: {
		label: 'Basic',
		priceCents: 4900,
		currency: 'eur',
		prices: {
			da: { priceCents: 24900, currency: 'dkk' },
			en: { priceCents: 4900, currency: 'eur' },
		},
		retentionDays: 15,
		photoCap: 500,
		watermark: false,
	},
	gold: {
		label: 'Gold',
		priceCents: 9900,
		currency: 'eur',
		prices: {
			da: { priceCents: 49900, currency: 'dkk' },
			en: { priceCents: 9900, currency: 'eur' },
		},
		retentionDays: 30,
		photoCap: 2000,
		watermark: false,
	},
} as const

export type Tier = keyof typeof TIERS
export type TierPriceLocale = 'da' | 'en'
export const TIER_IDS = Object.keys(TIERS) as Tier[]

export function isTier(value: unknown): value is Tier {
	return typeof value === 'string' && value in TIERS
}

export function getTierPrice(tier: Tier, locale: TierPriceLocale = 'da') {
	return TIERS[tier].prices[locale]
}

export function formatPrice(tier: Tier, locale: TierPriceLocale = 'da'): string {
	const { priceCents, currency } = getTierPrice(tier, locale)
	if (priceCents === 0) return locale === 'da' ? 'Gratis' : 'Free'
	const amount = priceCents / 100
	const formatterLocale = locale === 'da' ? 'da-DK' : 'en-IE'
	return new Intl.NumberFormat(formatterLocale, {
		style: 'currency',
		currency: currency.toUpperCase(),
		maximumFractionDigits: 0,
	}).format(amount)
}

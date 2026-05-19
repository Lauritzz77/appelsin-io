import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Better Auth tables. We map Better Auth's `user` model onto our `hosts` table
// via Better Auth config; required auth fields live here alongside domain
// additions (stripeCustomerId, plan).
export const hosts = sqliteTable('hosts', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	name: text('name'),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	stripeCustomerId: text('stripe_customer_id'),
	plan: text('plan').notNull().default('free'),
})

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [index('sessions_user_id_idx').on(t.userId)]
)

export const accounts = sqliteTable('accounts', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => hosts.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verifications = sqliteTable('verifications', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// Domain tables.
export const events = sqliteTable(
	'events',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		hostId: text('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		eventDate: integer('event_date', { mode: 'timestamp' }).notNull(),
		shortCode: text('short_code').notNull(),
		tier: text('tier', { enum: ['free', 'basic', 'gold'] }).notNull().default('free'),
		retentionDays: integer('retention_days').notNull().default(7),
		status: text('status', { enum: ['draft', 'live', 'ended'] }).notNull().default('draft'),
		moderationMode: text('moderation_mode', { enum: ['open', 'queue'] }).notNull().default('queue'),
		brandingJson: text('branding_json'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		expiresAt: integer('expires_at', { mode: 'timestamp' }),
	},
	(t) => [
		uniqueIndex('events_short_code_idx').on(t.shortCode),
		index('events_host_id_idx').on(t.hostId),
		index('events_status_idx').on(t.status),
		index('events_expires_at_idx').on(t.expiresAt),
	]
)

export const photos = sqliteTable(
	'photos',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		cfImagesId: text('cf_images_id'),
		r2OriginalKey: text('r2_original_key'),
		uploaderFingerprint: text('uploader_fingerprint'),
		caption: text('caption'),
		status: text('status', { enum: ['pending', 'approved', 'rejected'] })
			.notNull()
			.default('pending'),
		nsfwScore: real('nsfw_score'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index('photos_event_id_idx').on(t.eventId),
		index('photos_status_idx').on(t.status),
	]
)

export const subscriptions = sqliteTable('subscriptions', {
	hostId: text('host_id')
		.primaryKey()
		.references(() => hosts.id, { onDelete: 'cascade' }),
	stripeSubId: text('stripe_sub_id').notNull(),
	tier: text('tier').notNull(),
	// Mirror of Stripe's subscription.status — drives whether the host has Pro
	// access right now and what the billing page renders.
	status: text('status', {
		enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'],
	})
		.notNull()
		.default('active'),
	cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
	currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }),
})

// Payment records survive event / host deletion: Danish bookkeeping law
// requires 5-year retention (see privacy §6). FKs are `set null` so we keep
// the stripeSessionId and tier even after the event metadata is wiped.
export const eventPurchases = sqliteTable(
	'event_purchases',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		hostId: text('host_id').references(() => hosts.id, { onDelete: 'set null' }),
		eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
		stripeSessionId: text('stripe_session_id'),
		tier: text('tier').notNull(),
	},
	(t) => [
		index('event_purchases_host_id_idx').on(t.hostId),
		index('event_purchases_event_id_idx').on(t.eventId),
		// Stripe delivers webhooks at-least-once; this lets us ON CONFLICT DO
		// NOTHING in the handler instead of double-recording a purchase.
		uniqueIndex('event_purchases_stripe_session_idx').on(t.stripeSessionId),
	]
)

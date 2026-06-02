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
		// Currency/locale chosen when the event was created (server-derived from
		// the localized create form), frozen so checkout can't be steered to a
		// cheaper currency via a client header.
		priceLocale: text('price_locale', { enum: ['da', 'en'] }).notNull().default('da'),
		retentionDays: integer('retention_days').notNull().default(7),
		status: text('status', { enum: ['draft', 'live', 'ended'] }).notNull().default('draft'),
		moderationMode: text('moderation_mode', { enum: ['open', 'queue'] }).notNull().default('open'),
		hasBigScreen: integer('has_big_screen', { mode: 'boolean' }).notNull().default(true),
		brandingJson: text('branding_json'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		expiresAt: integer('expires_at', { mode: 'timestamp' }),
		endNotifiedAt: integer('end_notified_at', { mode: 'timestamp' }),
	},
	(t) => [
		uniqueIndex('events_short_code_idx').on(t.shortCode),
		index('events_host_id_idx').on(t.hostId),
		index('events_status_idx').on(t.status),
		index('events_expires_at_idx').on(t.expiresAt),
	]
)

// One row per guest who has claimed a display name on an event. Name uniqueness
// is per-event and case-insensitive: `name` keeps the original casing for
// display, `nameLower` powers the unique index. `token` is the opaque secret
// the guest's browser holds in localStorage; every authenticated guest call
// must present it.
export const eventUsers = sqliteTable(
	'event_users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		nameLower: text('name_lower').notNull(),
		// Lower-cased + trimmed. Used to email the guest a download link when
		// the event ends. Nullable at the DB level so we can backfill old
		// rows; the join endpoint requires it for new guests.
		email: text('email'),
		token: text('token').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		index('event_users_event_id_idx').on(t.eventId),
		uniqueIndex('event_users_event_name_idx').on(t.eventId, t.nameLower),
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
		eventUserId: text('event_user_id').references(() => eventUsers.id, {
			onDelete: 'set null',
		}),
		cfImagesId: text('cf_images_id'),
		cfStreamUid: text('cf_stream_uid'),
		mediaType: text('media_type', { enum: ['photo', 'video'] }).notNull().default('photo'),
		durationSeconds: integer('duration_seconds'),
		mediaWidth: integer('media_width'),
		mediaHeight: integer('media_height'),
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
		index('photos_event_user_id_idx').on(t.eventUserId),
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

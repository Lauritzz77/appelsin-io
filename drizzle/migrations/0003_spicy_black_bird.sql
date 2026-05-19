ALTER TABLE `subscriptions` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `event_purchases_stripe_session_idx` ON `event_purchases` (`stripe_session_id`);
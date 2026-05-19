PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text,
	`event_id` text,
	`stripe_session_id` text,
	`tier` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_event_purchases`("id", "host_id", "event_id", "stripe_session_id", "tier") SELECT "id", "host_id", "event_id", "stripe_session_id", "tier" FROM `event_purchases`;--> statement-breakpoint
DROP TABLE `event_purchases`;--> statement-breakpoint
ALTER TABLE `__new_event_purchases` RENAME TO `event_purchases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `event_purchases_host_id_idx` ON `event_purchases` (`host_id`);--> statement-breakpoint
CREATE INDEX `event_purchases_event_id_idx` ON `event_purchases` (`event_id`);
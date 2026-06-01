CREATE TABLE `event_users` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`name_lower` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_users_event_id_idx` ON `event_users` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_users_event_name_idx` ON `event_users` (`event_id`,`name_lower`);--> statement-breakpoint
ALTER TABLE `photos` ADD `event_user_id` text REFERENCES event_users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `photos_event_user_id_idx` ON `photos` (`event_user_id`);

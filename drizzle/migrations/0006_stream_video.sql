ALTER TABLE `photos` ADD `cf_stream_uid` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `media_type` text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `duration_seconds` integer;

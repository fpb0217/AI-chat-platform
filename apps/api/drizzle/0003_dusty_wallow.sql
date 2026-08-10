ALTER TABLE `conversations` ADD `title_source` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `title_turn_id` text;--> statement-breakpoint
CREATE INDEX `idx_conversations_updated_at` ON `conversations` (`updated_at`);
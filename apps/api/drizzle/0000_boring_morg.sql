CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`finish_reason` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_conversation_position` ON `messages` (`conversation_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_messages_status` ON `messages` (`status`);--> statement-breakpoint
CREATE INDEX `idx_messages_turn_id` ON `messages` (`turn_id`);
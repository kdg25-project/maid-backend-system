CREATE TABLE `instax_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instax_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`archived_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instax_id`) REFERENCES `instax`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instax_history_instax_id` ON `instax_history` (`instax_id`);
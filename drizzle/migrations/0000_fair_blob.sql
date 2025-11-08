CREATE TABLE `instax_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instax_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`archived_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instax_id`) REFERENCES `instax`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instax_history_instax_id` ON `instax_history` (`instax_id`);--> statement-breakpoint
CREATE TABLE `instax` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`maid_id` text NOT NULL,
	`image_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`maid_id`) REFERENCES `maid`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instax_user_id` ON `instax` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_instax_maid_id` ON `instax` (`maid_id`);--> statement-breakpoint
CREATE TABLE `maid` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`is_active` integer DEFAULT false NOT NULL,
	`is_instax_available` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `menu` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`stock` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_menu_name` ON `menu` (`name`);--> statement-breakpoint
CREATE TABLE `order` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`menu_id` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_order_user_id` ON `order` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_order_menu_id` ON `order` (`menu_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`maid_id` text,
	`instax_maid_id` text,
	`seat_id` integer,
	`is_valid` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`maid_id`) REFERENCES `maid`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`instax_maid_id`) REFERENCES `maid`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_user_maid_id` ON `user` (`maid_id`);--> statement-breakpoint
CREATE INDEX `idx_user_instax_maid_id` ON `user` (`instax_maid_id`);--> statement-breakpoint
CREATE INDEX `idx_user_seat_id` ON `user` (`seat_id`);
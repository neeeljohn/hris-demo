CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`grace_minutes` integer DEFAULT 10 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shifts_company_idx` ON `shifts` (`company_id`);--> statement-breakpoint
ALTER TABLE `employees` ADD `shift_id` text REFERENCES shifts(id);
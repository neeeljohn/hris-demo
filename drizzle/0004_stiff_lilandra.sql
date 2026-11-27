CREATE TABLE `pay_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`pay_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`total_gross` real DEFAULT 0 NOT NULL,
	`total_net` real DEFAULT 0 NOT NULL,
	`created_by` text,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_runs_period_idx` ON `pay_runs` (`company_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`pay_run_id` text NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`monthly_rate` real NOT NULL,
	`gross` real NOT NULL,
	`taxable` real NOT NULL,
	`total_deductions` real NOT NULL,
	`net` real NOT NULL,
	`lines` text NOT NULL,
	`adjustments` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_run_employee_idx` ON `payslips` (`pay_run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `payslips_employee_idx` ON `payslips` (`employee_id`);--> statement-breakpoint
ALTER TABLE `employees` ADD `monthly_rate` real;
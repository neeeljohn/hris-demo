CREATE TABLE `visit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visit_id` text NOT NULL,
	`name` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visit_events_at_idx` ON `visit_events` (`at`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`ip_masked` text,
	`country` text,
	`city` text,
	`region` text,
	`device` text,
	`browser` text,
	`os` text,
	`referrer` text,
	`landing_path` text,
	`roles` text DEFAULT '' NOT NULL,
	`page_views` integer DEFAULT 1 NOT NULL,
	`actions` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visits_started_idx` ON `visits` (`started_at`);--> statement-breakpoint
CREATE INDEX `visits_visitor_idx` ON `visits` (`visitor_id`);
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`account_id` text,
	`device_id` text,
	`ip_address` text,
	`detail_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_audit_event` ON `audit_logs` (`event`);--> statement-breakpoint
CREATE INDEX `ix_audit_time` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `backup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer,
	`sha256` text,
	`encrypted` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`whatsapp_chat_id` text NOT NULL,
	`chat_type` text DEFAULT 'INDIVIDUAL' NOT NULL,
	`name` text,
	`phone_number` text,
	`profile_photo_path` text,
	`archived` integer DEFAULT false NOT NULL,
	`whatsapp_deleted` integer DEFAULT false NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`last_message_at` integer,
	`last_message_preview` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chats_account_wa` ON `chats` (`account_id`,`whatsapp_chat_id`);--> statement-breakpoint
CREATE INDEX `ix_chats_updated_at` ON `chats` (`account_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `ix_chats_deleted` ON `chats` (`account_id`,`whatsapp_deleted`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`whatsapp_id` text NOT NULL,
	`phone_number` text,
	`name` text,
	`push_name` text,
	`profile_photo_path` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contacts_account_wa` ON `contacts` (`account_id`,`whatsapp_id`);--> statement-breakpoint
CREATE INDEX `ix_contacts_whatsapp_id` ON `contacts` (`whatsapp_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`account_scope` text,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`group_id` text NOT NULL,
	`participant_whatsapp_id` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`joined_at` integer,
	`left_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_participants_group` ON `group_participants` (`group_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`whatsapp_group_id` text NOT NULL,
	`name` text,
	`description` text,
	`photo_path` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_group` ON `groups` (`account_id`,`whatsapp_group_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`media_type` text NOT NULL,
	`mime_type` text,
	`original_filename` text,
	`storage_path` text,
	`thumbnail_path` text,
	`file_size` integer,
	`sha256` text,
	`width` integer,
	`height` integer,
	`duration` integer,
	`download_status` text DEFAULT 'PENDING' NOT NULL,
	`download_attempts` integer DEFAULT 0 NOT NULL,
	`encryption_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_media_message` ON `media` (`message_id`);--> statement-breakpoint
CREATE INDEX `ix_media_account` ON `media` (`account_id`);--> statement-breakpoint
CREATE INDEX `ix_media_sha256` ON `media` (`sha256`);--> statement-breakpoint
CREATE INDEX `ix_media_status` ON `media` (`account_id`,`download_status`);--> statement-breakpoint
CREATE TABLE `media_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`media_id` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`previous_text` text,
	`new_text` text,
	`edited_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_edits_message` ON `message_edits` (`message_id`);--> statement-breakpoint
CREATE TABLE `message_links` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_links_message` ON `message_links` (`message_id`);--> statement-breakpoint
CREATE TABLE `message_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`reactor_id` text NOT NULL,
	`emoji` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_reaction` ON `message_reactions` (`message_id`,`reactor_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`whatsapp_message_id` text NOT NULL,
	`sender_id` text,
	`participant_id` text,
	`timestamp` integer NOT NULL,
	`direction` text NOT NULL,
	`message_type` text NOT NULL,
	`text` text,
	`caption` text,
	`quoted_message_id` text,
	`reply_to_message_id` text,
	`forwarded` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`whatsapp_deleted` integer DEFAULT false NOT NULL,
	`archive_deleted` integer DEFAULT false NOT NULL,
	`deleted_from_whatsapp_at` integer,
	`edited_at` integer,
	`raw_metadata_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `whatsapp_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_messages_account_wa` ON `messages` (`account_id`,`whatsapp_message_id`);--> statement-breakpoint
CREATE INDEX `ix_messages_chat_time` ON `messages` (`account_id`,`chat_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `ix_messages_sender` ON `messages` (`account_id`,`sender_id`);--> statement-breakpoint
CREATE INDEX `ix_messages_type` ON `messages` (`account_id`,`message_type`);--> statement-breakpoint
CREATE INDEX `ix_messages_deleted` ON `messages` (`account_id`,`whatsapp_deleted`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`device_id` text,
	`token_hash` text NOT NULL,
	`account_scope` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_session_token` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`payload_json` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `whatsapp_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`phone_number` text,
	`whatsapp_jid` text,
	`profile_name` text,
	`profile_photo_path` text,
	`connection_status` text DEFAULT 'DISCONNECTED' NOT NULL,
	`archive_password_hash` text,
	`last_connected_at` integer,
	`last_sync_at` integer,
	`archive_started_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

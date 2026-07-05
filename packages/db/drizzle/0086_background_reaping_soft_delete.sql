ALTER TABLE `bookmarks` ADD `deletedAt` integer;--> statement-breakpoint
CREATE INDEX `bookmarks_deletedAt_idx` ON `bookmarks` (`deletedAt`);--> statement-breakpoint
CREATE INDEX `bookmarks_userId_deletedAt_idx` ON `bookmarks` (`userId`,`deletedAt`);--> statement-breakpoint
ALTER TABLE `user` ADD `deletedAt` integer;--> statement-breakpoint
CREATE INDEX `users_deletedAt_idx` ON `user` (`deletedAt`);
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";

import { getInMemoryDB } from "@karakeep/db/drizzle";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
  users,
} from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { reapDeletedBookmarks, reapDeletedUsers } from "./reapDeletedData";

function abortSignal() {
  return new AbortController().signal;
}

async function createDeletedUser(database: ReturnType<typeof getInMemoryDB>) {
  const [user] = await database
    .insert(users)
    .values({
      name: "Deleted User",
      email: `deleted-${randomUUID()}@example.com`,
      deletedAt: new Date(),
    })
    .returning();
  return user;
}

describe("reapDeletedData", () => {
  test("deletes bookmark assets before hard-deleting a soft-deleted bookmark", async () => {
    const database = getInMemoryDB(true);
    const user = await createDeletedUser(database);
    const [bookmark] = await database
      .insert(bookmarks)
      .values({
        userId: user.id,
        type: BookmarkTypes.ASSET,
        deletedAt: new Date(),
      })
      .returning();

    await database.insert(bookmarkAssets).values({
      id: bookmark.id,
      assetType: "pdf",
      assetId: "asset-main",
    });
    await database.insert(assets).values([
      {
        id: "asset-main",
        userId: user.id,
        bookmarkId: bookmark.id,
        assetType: AssetTypes.BOOKMARK_ASSET,
      },
      {
        id: "asset-extra",
        userId: user.id,
        bookmarkId: bookmark.id,
        assetType: AssetTypes.LINK_PDF,
      },
    ]);

    const deleteAssetFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      reapDeletedBookmarks("job", abortSignal(), { database, deleteAssetFn }),
    ).resolves.toBe(1);

    expect(deleteAssetFn).toHaveBeenCalledWith({
      userId: user.id,
      assetId: "asset-main",
    });
    expect(deleteAssetFn).toHaveBeenCalledWith({
      userId: user.id,
      assetId: "asset-extra",
    });
    await expect(
      database.query.bookmarks.findFirst({
        where: eq(bookmarks.id, bookmark.id),
      }),
    ).resolves.toBeUndefined();
  });

  test("keeps a soft-deleted bookmark for retry when asset deletion fails", async () => {
    const database = getInMemoryDB(true);
    const user = await createDeletedUser(database);
    const [bookmark] = await database
      .insert(bookmarks)
      .values({
        userId: user.id,
        type: BookmarkTypes.TEXT,
        deletedAt: new Date(),
      })
      .returning();
    await database.insert(assets).values({
      id: "asset-fails",
      userId: user.id,
      bookmarkId: bookmark.id,
      assetType: AssetTypes.LINK_PDF,
    });

    const deleteAssetFn = vi.fn().mockRejectedValue(new Error("s3 failed"));

    await expect(
      reapDeletedBookmarks("job", abortSignal(), { database, deleteAssetFn }),
    ).resolves.toBe(0);

    await expect(
      database.query.bookmarks.findFirst({
        where: eq(bookmarks.id, bookmark.id),
      }),
    ).resolves.toMatchObject({ id: bookmark.id });
  });

  test("hard-deletes deleted users only after their bookmarks are gone", async () => {
    const database = getInMemoryDB(true);
    const userWithBookmark = await createDeletedUser(database);
    const userWithoutBookmarks = await createDeletedUser(database);
    await database.insert(bookmarks).values({
      userId: userWithBookmark.id,
      type: BookmarkTypes.TEXT,
      deletedAt: new Date(),
    });

    const deleteUserAssetsFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      reapDeletedUsers("job", abortSignal(), {
        database,
        deleteUserAssetsFn,
      }),
    ).resolves.toBe(1);

    expect(deleteUserAssetsFn).toHaveBeenCalledWith({
      userId: userWithoutBookmarks.id,
    });
    await expect(
      database.query.users.findFirst({
        where: eq(users.id, userWithoutBookmarks.id),
      }),
    ).resolves.toBeUndefined();
    await expect(
      database.query.users.findFirst({
        where: eq(users.id, userWithBookmark.id),
      }),
    ).resolves.toMatchObject({ id: userWithBookmark.id });
  });
});

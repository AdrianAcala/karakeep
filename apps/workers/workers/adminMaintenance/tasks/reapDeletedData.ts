import { and, asc, eq, isNotNull, notExists } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { db as defaultDb } from "@karakeep/db";
import { bookmarks, users } from "@karakeep/db/schema";
import type { ZAdminMaintenanceReapDeletedDataTask } from "@karakeep/shared-server";
import { EmbeddingsQueue, SearchIndexingQueue } from "@karakeep/shared-server";
import {
  deleteAsset as defaultDeleteAsset,
  deleteUserAssets as defaultDeleteUserAssets,
} from "@karakeep/shared/assetdb";
import logger from "@karakeep/shared/logger";
import type { DequeuedJob } from "@karakeep/shared/queueing";

const BOOKMARK_BATCH_SIZE = 25;
const USER_BATCH_SIZE = 5;

type DeleteAssetFn = typeof defaultDeleteAsset;
type DeleteUserAssetsFn = typeof defaultDeleteUserAssets;
type EnqueueBookmarkDeleteCleanupFn = typeof enqueueBookmarkDeleteCleanup;

interface ReapDeletedDataDeps {
  database?: DB;
  deleteAssetFn?: DeleteAssetFn;
  deleteUserAssetsFn?: DeleteUserAssetsFn;
  enqueueBookmarkDeleteCleanupFn?: EnqueueBookmarkDeleteCleanupFn;
}

async function enqueueBookmarkDeleteCleanup({
  bookmarkId,
  userId,
}: {
  bookmarkId: string;
  userId: string;
}) {
  await SearchIndexingQueue.enqueue(
    {
      bookmarkId,
      type: "delete",
    },
    {
      groupId: userId,
    },
  );
  await EmbeddingsQueue.enqueue(
    {
      bookmarkId,
      type: "delete",
    },
    {
      groupId: userId,
    },
  );
}

async function reapDeletedBookmark(
  database: DB,
  bookmark: Awaited<ReturnType<typeof getDeletedBookmarkBatch>>[number],
  deleteAssetFn: DeleteAssetFn,
  enqueueBookmarkDeleteCleanupFn: EnqueueBookmarkDeleteCleanupFn,
) {
  const assetIds = new Set(bookmark.assets.map((asset) => asset.id));
  if (bookmark.asset?.assetId) {
    assetIds.add(bookmark.asset.assetId);
  }

  for (const assetId of assetIds) {
    await deleteAssetFn({ userId: bookmark.userId, assetId });
  }

  await enqueueBookmarkDeleteCleanupFn({
    bookmarkId: bookmark.id,
    userId: bookmark.userId,
  });

  await database
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, bookmark.id), isNotNull(bookmarks.deletedAt)));
}

async function getDeletedBookmarkBatch(database: DB) {
  return await database.query.bookmarks.findMany({
    where: isNotNull(bookmarks.deletedAt),
    with: {
      assets: true,
      asset: true,
    },
    orderBy: [asc(bookmarks.deletedAt), asc(bookmarks.id)],
    limit: BOOKMARK_BATCH_SIZE,
  });
}

export async function reapDeletedBookmarks(
  jobId: string,
  abortSignal: AbortSignal,
  {
    database = defaultDb,
    deleteAssetFn = defaultDeleteAsset,
    enqueueBookmarkDeleteCleanupFn = enqueueBookmarkDeleteCleanup,
  }: ReapDeletedDataDeps = {},
) {
  let reaped = 0;

  while (!abortSignal.aborted) {
    const deletedBookmarks = await getDeletedBookmarkBatch(database);
    if (deletedBookmarks.length === 0) {
      break;
    }

    let reapedInBatch = 0;
    for (const bookmark of deletedBookmarks) {
      if (abortSignal.aborted) {
        break;
      }

      try {
        await reapDeletedBookmark(
          database,
          bookmark,
          deleteAssetFn,
          enqueueBookmarkDeleteCleanupFn,
        );
        reaped += 1;
        reapedInBatch += 1;
      } catch (error) {
        logger.error(
          `[adminMaintenance:reap_deleted_data][${jobId}] Failed to reap bookmark ${bookmark.id}: ${error}`,
        );
      }
    }

    if (reapedInBatch === 0) {
      break;
    }
  }

  return reaped;
}

async function reapDeletedUser(
  database: DB,
  user: Pick<typeof users.$inferSelect, "id">,
  deleteUserAssetsFn: DeleteUserAssetsFn,
) {
  await deleteUserAssetsFn({ userId: user.id });
  await database
    .delete(users)
    .where(and(eq(users.id, user.id), isNotNull(users.deletedAt)));
}

export async function reapDeletedUsers(
  jobId: string,
  abortSignal: AbortSignal,
  {
    database = defaultDb,
    deleteUserAssetsFn = defaultDeleteUserAssets,
  }: ReapDeletedDataDeps = {},
) {
  let reaped = 0;

  while (!abortSignal.aborted) {
    const deletedUsers = await database
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNotNull(users.deletedAt),
          notExists(
            database
              .select({ id: bookmarks.id })
              .from(bookmarks)
              .where(eq(bookmarks.userId, users.id)),
          ),
        ),
      )
      .orderBy(asc(users.deletedAt), asc(users.id))
      .limit(USER_BATCH_SIZE);

    if (deletedUsers.length === 0) {
      break;
    }

    let reapedInBatch = 0;
    for (const user of deletedUsers) {
      if (abortSignal.aborted) {
        break;
      }

      try {
        await reapDeletedUser(database, user, deleteUserAssetsFn);
        reaped += 1;
        reapedInBatch += 1;
      } catch (error) {
        logger.error(
          `[adminMaintenance:reap_deleted_data][${jobId}] Failed to reap user ${user.id}: ${error}`,
        );
      }
    }

    if (reapedInBatch === 0) {
      break;
    }
  }

  return reaped;
}

export async function runReapDeletedDataTask(
  job: DequeuedJob<ZAdminMaintenanceReapDeletedDataTask>,
  deps: ReapDeletedDataDeps = {},
): Promise<void> {
  const jobId = job.id;
  const reapedBookmarks = await reapDeletedBookmarks(
    jobId,
    job.abortSignal,
    deps,
  );
  const reapedUsers = await reapDeletedUsers(jobId, job.abortSignal, deps);

  logger.info(
    `[adminMaintenance:reap_deleted_data][${jobId}] Reaped ${reapedBookmarks} bookmarks and ${reapedUsers} users`,
  );
}

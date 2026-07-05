// @vitest-environment jsdom

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { EditBookmarkDialog } from "./EditBookmarkDialog";

const {
  mockUpdateBookmark,
  mockUpdateTags,
  mockToast,
  simulateImmediateTagFeedRemoval,
  setSimulateImmediateTagFeedRemoval,
} = vi.hoisted(() => {
  let immediateTagFeedRemoval: (() => void) | undefined;

  return {
    mockUpdateBookmark: vi.fn(),
    mockUpdateTags: vi.fn(),
    mockToast: vi.fn(),
    simulateImmediateTagFeedRemoval: () => immediateTagFeedRemoval?.(),
    setSimulateImmediateTagFeedRemoval: (cb?: () => void) => {
      immediateTagFeedRemoval = cb;
    },
  };
});

vi.mock("@/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          "actions.cancel": "Cancel",
          "bookmark_editor.pick_a_date": "Pick a date",
          "bookmark_editor.save_changes": "Save changes",
          "bookmark_editor.subtitle":
            "Make changes to the bookmark details. Click save when you're done.",
          "bookmark_editor.title": "Edit Bookmark",
          "common.created_at": "Created At",
          "common.note": "Note",
          "common.tags": "Tags",
          "common.title": "Title",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: mockToast,
}));

vi.mock("@karakeep/shared-react/trpc", () => ({
  useTRPC: () => ({
    bookmarks: {
      getBookmark: {
        queryOptions: () => ({
          queryKey: ["bookmark"],
          queryFn: async () => bookmark,
        }),
      },
    },
  }),
}));

vi.mock("@karakeep/shared-react/hooks/bookmarks", () => ({
  useUpdateBookmark: () => ({
    mutateAsync: mockUpdateBookmark,
    isPending: false,
  }),
  useUpdateBookmarkTags: () => ({
    mutate: simulateImmediateTagFeedRemoval,
    mutateAsync: mockUpdateTags,
    isPending: false,
  }),
}));

vi.mock("./BookmarkTagsEditor", () => ({
  BookmarkTagsEditor: () => (
    <button type="button" onClick={simulateImmediateTagFeedRemoval}>
      Remove issue2798
    </button>
  ),
}));

vi.mock("./TagsEditor", () => ({
  TagsEditor: ({
    tags,
    onDetach,
  }: {
    tags: { id: string; name: string }[];
    onDetach: (tag: { tagName: string; tagId: string }) => void;
  }) => (
    <div>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => onDetach({ tagId: tag.id, tagName: tag.name })}
        >
          Remove {tag.name}
        </button>
      ))}
    </div>
  ),
}));

const bookmark: ZBookmark = {
  id: "bookmark-1",
  archived: false,
  assets: [],
  content: {
    type: BookmarkTypes.TEXT,
    text: "Issue reproduction",
    sourceUrl: null,
  },
  createdAt: new Date("2026-07-05T12:00:00.000Z"),
  embeddingStatus: "success",
  favourited: false,
  modifiedAt: null,
  note: "Original note",
  source: "web",
  summary: null,
  summarizationStatus: "success",
  taggingStatus: "success",
  tags: [{ id: "tag-1", name: "issue2798", attachedBy: "human" }],
  title: "Original title",
  userId: "user-1",
};

function renderInTagFeed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function TagFeedHarness() {
    const [visible, setVisible] = React.useState(true);

    React.useEffect(() => {
      setSimulateImmediateTagFeedRemoval(() => setVisible(false));
      return () => setSimulateImmediateTagFeedRemoval();
    }, []);

    return (
      <QueryClientProvider client={queryClient}>
        {visible ? (
          <EditBookmarkDialog
            bookmark={bookmark}
            open={true}
            setOpen={(open) => {
              if (!open) {
                setVisible(false);
              }
            }}
          />
        ) : (
          <div>0 items</div>
        )}
      </QueryClientProvider>
    );
  }

  return render(<TagFeedHarness />);
}

describe("EditBookmarkDialog", () => {
  beforeEach(() => {
    mockToast.mockClear();
    mockUpdateBookmark.mockReset();
    mockUpdateTags.mockReset();
    mockUpdateBookmark.mockResolvedValue(bookmark);
    mockUpdateTags.mockResolvedValue({ attached: [], detached: ["tag-1"] });
  });

  it("keeps tag edits staged so removing the current feed tag does not unmount unsaved edits", async () => {
    renderInTagFeed();

    const titleInput = screen.getByPlaceholderText("Bookmark title");
    fireEvent.change(titleInput, {
      target: { value: "Unsaved title from regression test" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove issue2798" }));

    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.queryByText("0 items")).toBeNull();
    expect(mockUpdateTags).not.toHaveBeenCalled();
    expect((titleInput as HTMLInputElement).value).toBe(
      "Unsaved title from regression test",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateBookmark).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockUpdateTags).toHaveBeenCalledWith({
        bookmarkId: "bookmark-1",
        attach: [],
        detach: [{ tagId: "tag-1" }],
      }),
    );
  });
});

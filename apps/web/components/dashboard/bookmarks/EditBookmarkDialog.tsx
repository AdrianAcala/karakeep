import * as React from "react";
import { z } from "zod";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { useDialogFormReset } from "@/lib/hooks/useDialogFormReset";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  useUpdateBookmark,
  useUpdateBookmarkTags,
} from "@karakeep/shared-react/hooks/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  BookmarkTypes,
  ZBookmark,
  zUpdateBookmarksRequestSchema,
} from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import { TagsEditor } from "./TagsEditor";

const formSchema = zUpdateBookmarksRequestSchema.extend({
  createdAt: z.date().optional(),
  datePublished: z.date().nullish(),
  dateModified: z.date().nullish(),
});
type BookmarkFormValues = z.infer<typeof formSchema>;
interface PendingTagAttach {
  tagName: string;
  tagId?: string;
}
interface PendingTagDetach {
  tagName: string;
  tagId: string;
}

export function EditBookmarkDialog({
  open,
  setOpen,
  bookmark,
  children,
}: {
  bookmark: ZBookmark;
  children?: React.ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const api = useTRPC();
  const { t } = useTranslation();

  const { data: assetContent, isLoading: isAssetContentLoading } = useQuery(
    api.bookmarks.getBookmark.queryOptions(
      {
        bookmarkId: bookmark.id,
        includeContent: true,
      },
      {
        enabled: open && bookmark.content.type == BookmarkTypes.ASSET,
        select: (b) =>
          b.content.type == BookmarkTypes.ASSET ? b.content.content : null,
      },
    ),
  );

  const bookmarkToDefault = (bookmark: ZBookmark): BookmarkFormValues => ({
    bookmarkId: bookmark.id,
    summary: bookmark.summary,
    note: bookmark.note === null ? undefined : bookmark.note,
    title: getBookmarkTitle(bookmark),
    createdAt: bookmark.createdAt ?? new Date(),
    // Link specific defaults (only if bookmark is a link)
    url:
      bookmark.content.type === BookmarkTypes.LINK
        ? bookmark.content.url
        : undefined,
    description:
      bookmark.content.type === BookmarkTypes.LINK
        ? (bookmark.content.description ?? "")
        : undefined,
    author:
      bookmark.content.type === BookmarkTypes.LINK
        ? (bookmark.content.author ?? "")
        : undefined,
    publisher:
      bookmark.content.type === BookmarkTypes.LINK
        ? (bookmark.content.publisher ?? "")
        : undefined,
    datePublished:
      bookmark.content.type === BookmarkTypes.LINK
        ? bookmark.content.datePublished
        : undefined,
    // Asset specific fields
    assetContent: assetContent ?? undefined,
  });

  const form = useForm<BookmarkFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: bookmarkToDefault(bookmark),
  });
  const [pendingTagAttaches, setPendingTagAttaches] = React.useState<
    PendingTagAttach[]
  >([]);
  const [pendingTagDetaches, setPendingTagDetaches] = React.useState<
    PendingTagDetach[]
  >([]);

  React.useEffect(() => {
    if (open) {
      setPendingTagAttaches([]);
      setPendingTagDetaches([]);
    }
  }, [bookmark.id, open]);

  const {
    mutateAsync: updateBookmarkMutateAsync,
    isPending: isUpdatingBookmark,
  } = useUpdateBookmark();
  const {
    mutateAsync: updateBookmarkTagsMutateAsync,
    isPending: isUpdatingTags,
  } = useUpdateBookmarkTags();

  async function onSubmit(values: BookmarkFormValues) {
    // Ensure optional fields that are empty strings are sent as null/undefined if appropriate
    const payload = {
      ...values,
      title: values.title ?? null,
    };
    try {
      const updatedBookmark = await updateBookmarkMutateAsync(payload);
      if (pendingTagAttaches.length > 0 || pendingTagDetaches.length > 0) {
        await updateBookmarkTagsMutateAsync({
          bookmarkId: bookmark.id,
          attach: pendingTagAttaches,
          detach: pendingTagDetaches.map(({ tagId }) => ({ tagId })),
        });
      }

      toast({ description: "Bookmark details updated successfully!" });
      setOpen(false);
      setPendingTagAttaches([]);
      setPendingTagDetaches([]);
      // Reset form with potentially updated data
      form.reset(bookmarkToDefault(updatedBookmark));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to update bookmark",
        description:
          error instanceof Error
            ? error.message
            : "There was a problem with your request.",
      });
    }
  }

  const onAttachTag = React.useCallback(
    ({ tagName, tagId }: PendingTagAttach) => {
      setPendingTagDetaches((prev) =>
        tagId ? prev.filter((tag) => tag.tagId !== tagId) : prev,
      );

      const isInitialTag = bookmark.tags.some((tag) =>
        tagId ? tag.id === tagId : tag.name === tagName,
      );
      if (isInitialTag) {
        return;
      }

      setPendingTagAttaches((prev) => {
        const alreadyPending = prev.some((tag) =>
          tagId && tag.tagId ? tag.tagId === tagId : tag.tagName === tagName,
        );
        return alreadyPending ? prev : [...prev, { tagName, tagId }];
      });
    },
    [bookmark.tags],
  );

  const onDetachTag = React.useCallback(
    ({ tagName, tagId }: PendingTagDetach) => {
      setPendingTagAttaches((prev) =>
        prev.filter((tag) =>
          tag.tagId && !tag.tagId.startsWith("temp-")
            ? tag.tagId !== tagId
            : tag.tagName !== tagName,
        ),
      );

      const isInitialTag = bookmark.tags.some((tag) => tag.id === tagId);
      if (!isInitialTag) {
        return;
      }

      setPendingTagDetaches((prev) =>
        prev.some((tag) => tag.tagId === tagId)
          ? prev
          : [...prev, { tagName, tagId }],
      );
    },
    [bookmark.tags],
  );

  // Reset form only when dialog is initially opened to preserve unsaved changes
  // This prevents losing unsaved title edits when tags are updated, which would
  // cause the bookmark prop to change and trigger a form reset
  useDialogFormReset(open, form, bookmarkToDefault(bookmark));

  // Update assetContent field when it's loaded
  React.useEffect(() => {
    if (assetContent && bookmark.content.type === BookmarkTypes.ASSET) {
      form.setValue("assetContent", assetContent);
    }
  }, [assetContent, bookmark.content.type, form]);

  const isLink = bookmark.content.type === BookmarkTypes.LINK;
  const isAsset = bookmark.content.type === BookmarkTypes.ASSET;
  const isSaving = isUpdatingBookmark || isUpdatingTags;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("bookmark_editor.title")}</DialogTitle>
          <DialogDescription>{t("bookmark_editor.subtitle")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.title")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Bookmark title"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isLink && (
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.url")}</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.note")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Bookmark notes"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            }

            {isLink && (
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Bookmark description"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isLink && (
              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.summary")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Bookmark summary"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isAsset && (
              <FormField
                control={form.control}
                name="assetContent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("bookmark_editor.extracted_content")}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        disabled={isAssetContentLoading}
                        placeholder="Extracted Content"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isLink && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="author"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("bookmark_editor.author")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Author name"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="publisher"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("bookmark_editor.publisher")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Publisher name"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="createdAt"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t("common.created_at")}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>{t("bookmark_editor.pick_a_date")}</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isLink && (
                <FormField
                  control={form.control}
                  name="datePublished"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>
                        {t("bookmark_editor.date_published")}
                      </FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground",
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>{t("bookmark_editor.pick_a_date")}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ?? undefined}
                            onSelect={(date) => field.onChange(date ?? null)} // Handle undefined -> null
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormItem>
              <FormLabel>{t("common.tags")}</FormLabel>
              <FormControl>
                <TagsEditor
                  tags={bookmark.tags}
                  onAttach={onAttachTag}
                  onDetach={onDetachTag}
                />
              </FormControl>
              <FormMessage />
            </FormItem>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSaving}
              >
                {t("actions.cancel")}
              </Button>
              <ActionButton type="submit" loading={isSaving}>
                {t("bookmark_editor.save_changes")}
              </ActionButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

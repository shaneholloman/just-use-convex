import { useMutation } from "@tanstack/react-query";
import { useConvexMutation, useConvexPaginatedQuery } from "@convex-dev/react-query";
import { api } from "@just-use-convex/backend/convex/_generated/api";
import type { z } from "zod";
import * as attachmentTypes from "@just-use-convex/backend/convex/attachments/types";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { toast } from "sonner";

type ListArgs = FunctionArgs<typeof api.attachments.index.list>;
export type AttachmentFilters = Omit<ListArgs, "paginationOpts">;
export type AttachmentItem = FunctionReturnType<typeof api.attachments.index.list>["page"][number];
type CreateFromHashResult = FunctionReturnType<typeof api.attachments.index.createFromHash>;

const INITIAL_NUM_ITEMS = 20;
const EMPTY_FILTERS: AttachmentFilters = {};

export function useAttachments() {
  const generateUploadUrlMutation = useMutation({
    mutationFn: useConvexMutation(api.attachments.index.generateUploadUrl),
  });

  const createFromHashMutation = useMutation({
    mutationFn: useConvexMutation(api.attachments.index.createFromHash),
  });

  const uploadMutation = useMutation({
    mutationKey: ["attachments", "upload"],
    mutationFn: async (args: z.infer<typeof attachmentTypes.CreateFromBytesArgs>): Promise<CreateFromHashResult> => {
      const blob = new Blob([args.fileBytes], {
        type: args.contentType ?? "application/octet-stream",
      });
      const safeFileName = args.fileName.replace(/[\r\n]+/g, " ").trim();

      const uploadUrl = await generateUploadUrlMutation.mutateAsync({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": args.contentType ?? "application/octet-stream",
        },
        body: blob,
      });

      const uploadResult = (await uploadResponse.json()) as { storageId: string };
      const hash = await toHexHash(args.fileBytes);
      return (await createFromHashMutation.mutateAsync({
        hash,
        storageId: uploadResult.storageId,
        size: args.fileBytes.byteLength,
        fileName: safeFileName,
        contentType: args.contentType,
      }));
    },
    onSuccess: () => {
      toast.success("Attachment uploaded");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to upload attachment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: useConvexMutation(api.attachments.index.deleteAttachment),
    onSuccess: () => {
      toast.success("Attachment deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete attachment");
    },
  });

  return {
    uploadAttachment: uploadMutation.mutateAsync,
    deleteAttachment: deleteMutation.mutateAsync,
    isUploading:
      uploadMutation.isPending ||
      generateUploadUrlMutation.isPending ||
      createFromHashMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useAttachmentsList(filters: AttachmentFilters = EMPTY_FILTERS) {
  return useConvexPaginatedQuery(
    api.attachments.index.list,
    { ...filters },
    { initialNumItems: INITIAL_NUM_ITEMS }
  );
}

async function toHexHash(bytes: Uint8Array) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

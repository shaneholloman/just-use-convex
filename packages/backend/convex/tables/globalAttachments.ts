import { z } from "zod";
import { defineEntFromTable } from "convex-ents";
import { Table } from "convex-helpers/server";
import { convexToZodFields, zid, zodToConvexFields } from "convex-helpers/server/zod4";

export const globalAttachmentsZodSchema = {
  hash: z.string(),
  storageId: zid("_storage"),
  size: z.number(),
  contentType: z.string().optional(),
};

export const globalAttachmentsFields = zodToConvexFields(globalAttachmentsZodSchema);

export const GlobalAttachments = Table("globalAttachments", globalAttachmentsFields);

export const systemFields = GlobalAttachments.systemFields;
export const zSystemFields = convexToZodFields(systemFields);

export const globalAttachmentsWithSystemFields = {
  ...globalAttachmentsZodSchema,
  ...zSystemFields,
};

const globalAttachmentsTable = GlobalAttachments.table
  .index("hash", ["hash"]);

export const globalAttachmentsEnt = defineEntFromTable(globalAttachmentsTable)
  .edges("orgMemberAttachments", { to: "orgMemberAttachments", ref: "globalAttachmentId" });

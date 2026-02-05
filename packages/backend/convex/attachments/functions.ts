import type { z } from "zod";
import type { zMutationCtx, zQueryCtx } from "../functions";
import * as types from "./types";
import { ROLE_HIERARCHY } from "../shared/auth_shared";

function isAdminOrAbove(role: string) {
  const level = ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY] ?? 0;
  return level >= ROLE_HIERARCHY.admin;
}

export async function CreateAttachmentFromHash(
  ctx: zMutationCtx,
  args: z.infer<typeof types.CreateFromHashArgs>
) {
  let globalAttachment = await ctx.table("globalAttachments", "hash", (q) =>
    q.eq("hash", args.hash)
  ).unique();

  if (!globalAttachment) {
    if (!args.storageId) {
      throw new Error("Storage id is required for new global attachments");
    }
    const globalAttachmentId = await ctx.db.insert("globalAttachments", {
      hash: args.hash,
      storageId: args.storageId,
      size: args.size,
      contentType: args.contentType,
    });
    globalAttachment = await ctx.table("globalAttachments").getX(globalAttachmentId);
  } else {
    await ctx.storage.delete(args.storageId);
  }

  if (!globalAttachment) {
    throw new Error("Failed to create global attachment");
  }

  const existingMemberAttachment = await ctx.table(
    "orgMemberAttachments",
    "organizationId_memberId_globalAttachmentId",
    (q) =>
      q
        .eq("organizationId", ctx.identity.activeOrganizationId)
        .eq("memberId", ctx.identity.memberId)
        .eq("globalAttachmentId", globalAttachment._id)
  ).unique();

  const url = await ctx.storage.getUrl(globalAttachment.storageId);
  if (!url) {
    throw new Error("Failed to generate attachment URL");
  }

  if (existingMemberAttachment) {
    return {
      globalAttachment: globalAttachment.doc(),
      orgMemberAttachment: existingMemberAttachment.doc(),
      url,
    };
  }

  const orgMemberAttachmentId = await ctx.table("orgMemberAttachments").insert({
    organizationId: ctx.identity.activeOrganizationId,
    memberId: ctx.identity.memberId,
    globalAttachmentId: globalAttachment._id,
    fileName: args.fileName,
    contentType: args.contentType,
    size: args.size,
    updatedAt: Date.now(),
  });
  const orgMemberAttachment = await ctx.table("orgMemberAttachments").getX(orgMemberAttachmentId);

  return {
    globalAttachment: globalAttachment.doc(),
    orgMemberAttachment: orgMemberAttachment.doc(),
    url,
  };
}

export async function GetOrgMemberAttachment(
  ctx: zQueryCtx,
  args: z.infer<typeof types.GetOrgMemberAttachmentArgs>
) {
  const attachment = await ctx.table("orgMemberAttachments").getX(args._id);
  if (attachment.organizationId !== ctx.identity.activeOrganizationId) {
    throw new Error("You are not authorized to view this attachment");
  }
  if (attachment.memberId !== ctx.identity.memberId) {
    throw new Error("You are not authorized to view this attachment");
  }

  const globalAttachment = await attachment.edge("globalAttachment");
  return {
    ...attachment.doc(),
    globalAttachment: globalAttachment.doc(),
  };
}

export async function GetGlobalAttachmentByHash(
  ctx: zQueryCtx,
  args: z.infer<typeof types.GetGlobalAttachmentByHashArgs>
) {
  const attachment = await ctx.table("globalAttachments", "hash", (q) =>
    q.eq("hash", args.hash)
  ).unique();

  return attachment ? attachment.doc() : null;
}

export async function ListOrgMemberAttachments(
  ctx: zQueryCtx,
  args: z.infer<typeof types.ListOrgMemberAttachmentsArgs>
) {
  const requestedMemberId = args.memberId ?? ctx.identity.memberId;
  if (args.memberId && !isAdminOrAbove(ctx.identity.organizationRole)) {
    throw new Error("You are not authorized to view other members' attachments");
  }

  const attachments = await ctx.table("orgMemberAttachments", "organizationId_memberId", (q) =>
    q
      .eq("organizationId", ctx.identity.activeOrganizationId)
      .eq("memberId", requestedMemberId)
  )
    .order("desc")
    .paginate(args.paginationOpts);

  const attachmentsWithGlobal = await Promise.all(
    attachments.page.map(async (attachment) => ({
      ...attachment.doc(),
      globalAttachment: (await attachment.edge("globalAttachment")).doc(),
    }))
  );

  return {
    ...attachments,
    page: attachmentsWithGlobal,
  };
}

export async function DeleteOrgMemberAttachment(
  ctx: zMutationCtx,
  args: z.infer<typeof types.DeleteOrgMemberAttachmentArgs>
) {
  const attachment = await ctx.table("orgMemberAttachments").getX(args._id);
  if (attachment.organizationId !== ctx.identity.activeOrganizationId) {
    throw new Error("You are not authorized to delete this attachment");
  }
  if (attachment.memberId !== ctx.identity.memberId && !isAdminOrAbove(ctx.identity.organizationRole)) {
    throw new Error("You are not authorized to delete other members' attachments");
  }

  const globalAttachmentId = attachment.globalAttachmentId;
  await attachment.delete();

  const remaining = await ctx.table("orgMemberAttachments", "globalAttachmentId", (q) =>
    q.eq("globalAttachmentId", globalAttachmentId)
  );

  if (remaining.length > 0) {
    return true;
  }

  const globalAttachment = await ctx.table("globalAttachments").getX(globalAttachmentId);
  await ctx.storage.delete(globalAttachment.storageId);
  await globalAttachment.delete();
  return true;
}

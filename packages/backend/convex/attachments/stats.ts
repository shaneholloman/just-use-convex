import { orgMemberAttachmentsByOrg, orgMemberAttachmentsByMember } from "./aggregates";
import type { zQueryCtx } from "../functions";

function exactBounds<K>(key: K) {
  return {
    bounds: {
      lower: { key, inclusive: true },
      upper: { key, inclusive: true },
    },
  };
}

export async function GetMemberAttachmentStats(ctx: zQueryCtx) {
  const orgId = ctx.identity.activeOrganizationId;
  const memberId = ctx.identity.memberId;

  const total = await orgMemberAttachmentsByMember.count(ctx, {
    namespace: orgId,
    ...exactBounds(memberId),
  });

  return { total };
}

export async function GetOrgAttachmentStats(ctx: zQueryCtx) {
  const orgId = ctx.identity.activeOrganizationId;

  const total = await orgMemberAttachmentsByOrg.count(ctx, exactBounds(orgId));

  return { total };
}

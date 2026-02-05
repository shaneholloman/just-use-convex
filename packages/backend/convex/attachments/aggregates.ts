import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════
// ORGANIZATION-LEVEL AGGREGATES
// ═══════════════════════════════════════════════════════════════════

export const orgMemberAttachmentsByOrg = new TableAggregate<{
  Key: string;
  DataModel: DataModel;
  TableName: "orgMemberAttachments";
}>(components.orgMemberAttachmentsByOrg, {
  sortKey: (doc) => doc.organizationId,
});

// ═══════════════════════════════════════════════════════════════════
// MEMBER-LEVEL AGGREGATES
// ═══════════════════════════════════════════════════════════════════

export const orgMemberAttachmentsByMember = new TableAggregate<{
  Namespace: string; // organizationId
  Key: string; // memberId
  DataModel: DataModel;
  TableName: "orgMemberAttachments";
}>(components.orgMemberAttachmentsByMember, {
  namespace: (doc) => doc.organizationId,
  sortKey: (doc) => doc.memberId,
});

export const allAttachmentAggregates = [orgMemberAttachmentsByOrg, orgMemberAttachmentsByMember];

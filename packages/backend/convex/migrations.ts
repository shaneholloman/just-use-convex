import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";

export const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

export const addIsPinnedToChats = migrations.define({
  table: "chats",
  migrateOne: async (ctx, chat) => {
    if ((chat as Record<string, unknown>).isPinned === undefined) {
      await ctx.db.patch(chat._id, { isPinned: false });
    }
  },
});

export const addMemberIdToChats = migrations.define({
  table: "chats",
  migrateOne: async (ctx, chat) => {
    const rawChat = chat as Record<string, unknown>;
    if (typeof rawChat.memberId === "string") {
      return;
    }

    const legacyUserId = rawChat.userId;
    if (typeof legacyUserId !== "string") {
      return;
    }

    const member = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        { field: "organizationId", operator: "eq", value: chat.organizationId },
        { field: "userId", operator: "eq", value: legacyUserId },
      ],
      select: ["_id"],
    });

    if (member) {
      await ctx.db.patch(chat._id, { memberId: member._id });
    }
  },
});

export const addMemberIdToTodos = migrations.define({
  table: "todos",
  migrateOne: async (ctx, todo) => {
    const rawTodo = todo as Record<string, unknown>;
    if (typeof rawTodo.memberId === "string") {
      return;
    }

    const legacyUserId = rawTodo.userId;
    if (typeof legacyUserId !== "string") {
      return;
    }

    const member = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "member",
      where: [
        { field: "organizationId", operator: "eq", value: todo.organizationId },
        { field: "userId", operator: "eq", value: legacyUserId },
      ],
      select: ["_id"],
    });

    if (member) {
      await ctx.db.patch(todo._id, { memberId: member._id });
    }
  },
});

export const deleteChatMissingMemberId = migrations.define({
  table: "chats",
  migrateOne: async (ctx, chat) => {
    if (chat._id === "jd704qq9mz8pkdee0vb46jbva17zw3kz") {
      await ctx.db.delete(chat._id);
    }
  },
});

export const deleteChatsWithoutMemberId = migrations.define({
  table: "chats",
  migrateOne: async (ctx, chat) => {
    const rawChat = chat as Record<string, unknown>;
    if (typeof rawChat.memberId !== "string") {
      await ctx.db.delete(chat._id);
    }
  },
});

export const deleteTodosWithoutMemberId = migrations.define({
  table: "todos",
  migrateOne: async (ctx, todo) => {
    const rawTodo = todo as Record<string, unknown>;
    if (typeof rawTodo.memberId !== "string") {
      await ctx.db.delete(todo._id);
    }
  },
});

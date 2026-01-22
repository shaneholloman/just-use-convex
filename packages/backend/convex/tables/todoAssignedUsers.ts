import { z } from "zod";
import { defineEntFromTable } from "convex-ents";
import { Table } from "convex-helpers/server";
import { convexToZodFields, zodToConvexFields } from "convex-helpers/server/zod4";
import { v } from "convex/values";

export const todoAssignedUsersZodSchema = {
  userId: z.string(),
  assignedBy: z.string(),
};

export const todoAssignedUsersFields = {
  ...zodToConvexFields(todoAssignedUsersZodSchema),
  todoId: v.id("todos"),
};

export const TodoAssignedUsers = Table("todoAssignedUsers", todoAssignedUsersFields);

const systemFields = TodoAssignedUsers.systemFields;
const zSystemFields = convexToZodFields(systemFields);

export const todoAssignedUsersWithSystemFields = {
  ...todoAssignedUsersZodSchema,
  ...zSystemFields,
};

const todoAssignedUsersTable = TodoAssignedUsers.table
  .index("userId", ["userId"])
  .index("todoId_userId", ["todoId", "userId"]);

export const todoAssignedUsersEnt = defineEntFromTable(todoAssignedUsersTable)
  .edge("todo", { to: "todos", field: "todoId" });

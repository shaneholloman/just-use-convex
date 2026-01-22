import * as functions from "./functions";
import * as types from "./types";
import { zMutation, zQuery } from "../functions";

export const list = zQuery({
  args: types.ListArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.ListTodos>> => {
    return await functions.ListTodos(ctx, args);
  }
});

export const get = zQuery({
  args: types.GetTodoArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.GetTodo>> => {
    return await functions.GetTodo(ctx, args);
  }
});

export const create = zMutation({
  args: types.CreateArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.CreateTodo>> => {
    return await functions.CreateTodo(ctx, args);
  }
});

export const update = zMutation({
  args: types.UpdateArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.UpdateTodo>> => {
    return await functions.UpdateTodo(ctx, args);
  }
});

export const deleteTodo = zMutation({
  args: types.DeleteArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.DeleteTodo>> => {
    return await functions.DeleteTodo(ctx, args);
  }
});

export const assignUser = zMutation({
  args: types.AssignUserArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.AssignUser>> => {
    return await functions.AssignUser(ctx, args);
  }
});

export const unassignUser = zMutation({
  args: types.UnassignUserArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.UnassignUser>> => {
    return await functions.UnassignUser(ctx, args);
  }
});

export const listAssigned = zQuery({
  args: types.ListAssignedTodosArgs,
  handler: async (ctx, args): Promise<ReturnType<typeof functions.ListAssignedTodos>> => {
    return await functions.ListAssignedTodos(ctx, args);
  }
});
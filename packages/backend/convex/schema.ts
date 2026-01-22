import { defineEntSchema, getEntDefinitions } from "convex-ents";
import { todosEnt } from "./tables/todos";
import { todoAssignedUsersEnt } from "./tables/todoAssignedUsers";

const schema = defineEntSchema({
  todos: todosEnt,
  todoAssignedUsers: todoAssignedUsersEnt,
});

export default schema;
export const entDefinitions = getEntDefinitions(schema);

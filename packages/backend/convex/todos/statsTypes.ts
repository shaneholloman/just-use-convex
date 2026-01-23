import { todosZodSchema } from "../tables/todos";

// Infer teamId type from todos schema
export const TeamStatsArgs = {
  teamId: todosZodSchema.teamId,
};

// Infer userId type from todos schema
export const UserStatsArgs = {
  userId: todosZodSchema.userId.optional(),
};

import betterAuth from "./betterAuth/convex.config";
import aggregate from "@convex-dev/aggregate/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterAuth);

// Organization-level aggregates
app.use(aggregate, { name: "todosByStatus" });
app.use(aggregate, { name: "todosByPriority" });
app.use(aggregate, { name: "todosByOrg" });

// Team-level aggregates
app.use(aggregate, { name: "todosByTeam" });
app.use(aggregate, { name: "todosByTeamStatus" });

// User-level aggregates
app.use(aggregate, { name: "todosByCreator" });
app.use(aggregate, { name: "todosByCreatorStatus" });

export default app;

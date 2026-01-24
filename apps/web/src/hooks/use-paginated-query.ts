import type { PaginationStatus, UsePaginatedQueryResult } from "convex/react";

export type { PaginationStatus, UsePaginatedQueryResult };

/**
 * Simplified paginated query result for components that don't need the full type.
 * Use this when passing pagination props between components.
 */
export type PaginatedQueryResult<T> = {
  results: T[];
  loadMore: (numItems: number) => void;
  status: PaginationStatus;
};

/**
 * Extract the result type from a paginated query hook return value.
 * Useful for inferring types from useConvexPaginatedQuery.
 */
export type InferPaginatedResult<T> = T extends { results: infer R extends unknown[] }
  ? R[number]
  : never;

/**
 * Props for components that accept pagination controls.
 */
export type PaginationProps = {
  loadMore?: (count: number) => void;
  status?: PaginationStatus;
};

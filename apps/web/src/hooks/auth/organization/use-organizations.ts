import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export const organizationsKeys = {
  all: ["organizations"] as const,
  list: () => [...organizationsKeys.all, "list"] as const,
};

export function useOrganizations() {
  const { data: organizations, isPending, error, refetch } = authClient.useListOrganizations();

  return {
    organizations: organizations ?? [],
    isPending,
    error,
    refetch,
  };
}

export function useActiveOrganization() {
  const activeOrganization = authClient.useActiveOrganization();
  const router = useRouter();
  const queryClient = useQueryClient();

  const setActiveOrganizationMutation = useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await authClient.organization.setActive({ organizationId });
      await authClient.getSession();
      await queryClient.refetchQueries();
      await router.invalidate();
      return result.data;
    },
    onError: (error: { error?: { message?: string } }) => {
      toast.error(error.error?.message || "Failed to switch organization");
    },
  });

  return {
    activeOrganization,
    setActiveOrganization: setActiveOrganizationMutation
  };
}


export function useCreateOrganization() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: async (data: { name: string; slug: string }) => {
      const result = await authClient.organization.create(data);

      if (result.data?.id) {
        await authClient.organization.setActive({ organizationId: result.data.id });
        await queryClient.refetchQueries();
        await router.invalidate();
      }
      return result.data;
    },
    onSuccess: () => {
      toast.success("Organization created successfully");
      queryClient.invalidateQueries({ queryKey: organizationsKeys.all });
    },
    onError: (error: { error?: { message?: string } }) => {
      toast.error(error.error?.message || "Failed to create organization");
    },
  });

  return {
    createOrganization: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

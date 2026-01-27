import { createFileRoute, Outlet, useRouteContext } from '@tanstack/react-router'
import { AgentsProvider } from '@/providers/agent'

export const Route = createFileRoute('/(protected)/chats')({
  component: RouteComponent,
})

function RouteComponent() {
  const { token } = useRouteContext({ from: "__root__" });
  return (
    <AgentsProvider token={token}>
      <div className="h-full">
        <Outlet />
      </div>
    </AgentsProvider>
  )
}

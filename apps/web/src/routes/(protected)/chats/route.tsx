import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AgentsProvider } from '@/providers/agent'

export const Route = createFileRoute('/(protected)/chats')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AgentsProvider>
      <div className="h-full">
        <Outlet />
      </div>
    </AgentsProvider>
  )
}

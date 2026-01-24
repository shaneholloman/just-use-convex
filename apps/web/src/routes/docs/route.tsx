import { createFileRoute } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';

export const Route = createFileRoute('/docs')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="absolute w-full h-svh">
      <RootProvider>
        <Outlet />
      </RootProvider>
    </div>
  )
}

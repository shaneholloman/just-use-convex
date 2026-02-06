import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react';
import SignInForm from '@/components/auth/sign-in-form';
import SignUpForm from '@/components/auth/sign-up-form';

export const Route = createFileRoute('/(public)/auth')({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const parentData = context;
    if (parentData?.isAuthenticated) {
      throw redirect({
        to: '/dashboard',
      });
    }
  },
})

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    document.cookie.split(';').forEach(cookie => {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  }, []);
  
  return (
    <div className="flex flex-col gap-2 p-2">
      {showSignIn ? (
        <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
      ) : (
        <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
      )}
    </div>
  );
}

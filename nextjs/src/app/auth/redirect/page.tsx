import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AuthRedirectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  // New OAuth user — not yet in the DB, must verify Sleeper membership first
  if (session.user.pendingOAuth) {
    redirect('/auth/connect-sleeper');
  }

  redirect('/league/dashboard');
}

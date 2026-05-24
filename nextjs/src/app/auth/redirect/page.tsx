import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function AuthRedirectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  redirect('/league/dashboard');
}

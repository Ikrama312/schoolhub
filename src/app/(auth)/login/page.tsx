import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · SchoolHub' };

export default function LoginPage({ searchParams }: { searchParams: { callbackUrl?: string; reset?: string } }) {
  return <LoginForm callbackUrl={searchParams.callbackUrl} reset={searchParams.reset === '1'} />;
}

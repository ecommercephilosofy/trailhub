import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function RootPage() {
  redirect((await getSession()) ? '/inici' : '/entrar');
}

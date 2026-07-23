'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navigation item. The current section is marked with a burgundy rule and
 * `aria-current`, never with colour alone.
 */
export function NavLink({
  href,
  children,
  variant = 'side',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'side' | 'bottom';
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  if (variant === 'bottom') {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`no-underline flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-[10px] font-semibold tracking-wide ${
          active
            ? 'text-[var(--color-burgundy)] border-t-2 border-[var(--color-burgundy)] -mt-[1px]'
            : 'text-[var(--color-ink-soft)]'
        }`}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`no-underline block px-3 py-[7px] rounded-[var(--radius-sm)] text-[12px] font-semibold tracking-[0.04em] ${
        active
          ? 'bg-[var(--color-burgundy)] text-white'
          : 'text-[var(--color-ink)] hover:bg-[var(--color-paper-raised)]'
      }`}
    >
      {children}
    </Link>
  );
}

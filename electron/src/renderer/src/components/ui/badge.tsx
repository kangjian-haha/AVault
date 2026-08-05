import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Badge({ className, variant: _variant, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: 'secondary' }) {
  return <span className={cn('inline-flex items-center rounded-md border border-white/10 bg-white/6 px-2 py-0.5 text-xs text-zinc-300', className)} {...props} />
}

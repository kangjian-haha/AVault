import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/15', className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('min-h-24 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/15', className)} {...props} />
}

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root
export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn('flex h-9 min-w-32 items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-zinc-300 outline-none hover:bg-white/8', className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown className="size-3.5" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
}
export const SelectValue = SelectPrimitive.Value
export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={6} className={cn('z-[80] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-white/10 bg-[#202127] p-1 shadow-xl', className)} {...props}><SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>
}
export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn('relative flex cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm text-zinc-300 outline-none data-[highlighted]:bg-violet-500/15 data-[highlighted]:text-white', className)} {...props}><span className="absolute left-2"><SelectPrimitive.ItemIndicator><Check className="size-4 text-violet-400" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>
}

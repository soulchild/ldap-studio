import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border border-input bg-surface text-foreground hover:bg-hover',
        ghost: 'text-foreground hover:bg-hover',
        /** Ghost in muted text, for secondary actions in toolbars and rows. */
        quiet: 'text-muted-foreground hover:bg-hover hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-8 gap-2 px-3 text-sm font-medium',
        /** Toolbars and dense rows. */
        sm: 'h-7 gap-1 px-2 text-xs',
        /** A square icon-only button; give it an aria-label. */
        icon: 'size-7 shrink-0',
        /** Inside a line of text: no height of its own, inherits the font size. */
        inline: 'px-1',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
)

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>): React.JSX.Element {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

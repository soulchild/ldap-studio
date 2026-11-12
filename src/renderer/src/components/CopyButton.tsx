import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'

const CONFIRM_MS = 2000

/**
 * Copies text to the clipboard and confirms it: the icon becomes a green check for two
 * seconds, and screen readers hear "Copied". `data-copied` is set meanwhile, so hover-only
 * action groups can stay visible (`has-data-copied:opacity-100`).
 */
export function CopyButton({
  text,
  label,
  className,
  iconClassName = 'size-3.5',
}: {
  text: string | (() => string)
  /** Accessible name, e.g. "Copy DN". */
  label: string
  className?: string
  iconClassName?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? 'Copied' : label}
      data-copied={copied ? true : undefined}
      onClick={async () => {
        const result = await window.api.invoke('clipboard.writeText', {
          text: typeof text === 'function' ? text() : text,
        })
        if (result.ok) {
          // Restart the confirmation on every click.
          setCopied(false)
          requestAnimationFrame(() => setCopied(true))
        }
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
        className,
      )}
    >
      {copied ? (
        <Check className={cn(iconClassName, 'text-success')} strokeWidth={2.5} aria-hidden />
      ) : (
        <Copy className={iconClassName} aria-hidden />
      )}
      <span role="status" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

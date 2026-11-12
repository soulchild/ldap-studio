import { cn } from '@renderer/lib/utils'

/** A row of mutually exclusive options, as a radio group. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex self-start rounded-sm border border-input bg-background p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-[3px] px-3 text-sm transition-colors',
            value === option.value
              ? 'bg-surface font-medium text-foreground shadow-[0_0_0_1px_var(--border-strong)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

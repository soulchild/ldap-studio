import { ChevronRight } from 'lucide-react'
import { keyOf } from '@renderer/tree/model'
import { ancestorsOf, parseDn, serializeDn, serializeRdn } from '@shared/dn'

/**
 * The entry's DN as a path from the root (design §15): each RDN is a segment with the
 * attribute type muted and the value strong; clicking a segment opens that ancestor.
 */
export function DnPath({
  dn,
  rootDns,
  onOpen,
}: {
  dn: string
  /** The tree's roots: the path starts at the root that contains `dn`, shown as one segment. */
  rootDns: string[]
  onOpen: (dn: string) => void
}): React.JSX.Element {
  const parsed = parseDn(dn)
  if (!parsed.ok) {
    return <p className="font-mono text-xs break-all">{dn}</p>
  }
  const all = [...ancestorsOf(parsed.dn), parsed.dn]
  const roots = new Set(rootDns.map((root) => keyOf(root)))
  const rootIndex = all.findIndex((level) => roots.has(keyOf(serializeDn(level))))
  const levels = rootIndex > 0 ? all.slice(rootIndex) : all
  return (
    <nav aria-label="Entry path" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
      {levels.map((level, index) => {
        // The root segment is the whole root DN, e.g. dc=example,dc=com.
        const rdn = index === 0 && rootIndex > 0 ? serializeDn(level) : serializeRdn(level[0] ?? [])
        const isLast = index === levels.length - 1
        const label = <SegmentLabel rdn={rdn} />
        return (
          <span key={index} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
            ) : null}
            {isLast ? (
              <span aria-current="page" className="truncate">
                {label}
              </span>
            ) : (
              <button
                type="button"
                title={serializeDn(level)}
                onClick={() => onOpen(serializeDn(level))}
                className="truncate rounded-sm px-1 py-0.5 hover:bg-hover"
              >
                {label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/** Attribute types muted, values strong; a multi-RDN root keeps its commas. */
function SegmentLabel({ rdn }: { rdn: string }): React.JSX.Element {
  const parsed = parseDn(rdn)
  if (!parsed.ok) {
    return <span>{rdn}</span>
  }
  return (
    <>
      {parsed.dn.map((part, index) => {
        const text = serializeRdn(part)
        const separator = text.indexOf('=')
        return (
          <span key={index}>
            {index > 0 ? <span className="text-muted-foreground">,</span> : null}
            <span className="text-muted-foreground">{text.slice(0, separator + 1)}</span>
            <span className="font-medium text-foreground">{text.slice(separator + 1)}</span>
          </span>
        )
      })}
    </>
  )
}

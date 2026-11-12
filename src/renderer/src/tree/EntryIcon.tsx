import {
  Building2,
  FileText,
  Folder,
  Globe,
  KeyRound,
  Link2,
  Monitor,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { EntryKind } from './entry-kind'

const ICONS: Record<EntryKind, LucideIcon> = {
  domain: Globe,
  organization: Building2,
  container: Folder,
  group: Users,
  person: User,
  computer: Monitor,
  alias: Link2,
  policy: KeyRound,
  other: FileText,
}

/** The icon for an entry kind; decorative, so the text next to it carries the meaning. */
export function EntryIcon({ kind, className }: { kind: EntryKind; className?: string }): React.JSX.Element {
  const Icon = ICONS[kind]
  return <Icon className={cn('size-3.5 shrink-0', className)} strokeWidth={1.75} aria-hidden />
}

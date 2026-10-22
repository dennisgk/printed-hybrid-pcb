import { Dialog as Primitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
export function Dialog({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return <Primitive.Root open={open} onOpenChange={onOpenChange}><Primitive.Portal><Primitive.Backdrop className="dialog-backdrop" /><Primitive.Popup className={`dialog ${wide ? 'dialog-wide' : ''}`}><div className="dialog-heading"><div><Primitive.Title>{title}</Primitive.Title>{description && <Primitive.Description>{description}</Primitive.Description>}</div><Primitive.Close className="close-button" aria-label="Close dialog"><X size={18} /></Primitive.Close></div>{children}</Primitive.Popup></Primitive.Portal></Primitive.Root>
}

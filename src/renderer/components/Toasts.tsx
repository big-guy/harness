import { useToasts } from '../toast'

/** Bottom-center stack of transient notifications. Driven by `showToast`. */
export function Toasts(): JSX.Element | null {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2 rounded-md border border-border-strong bg-panel-raised px-3 py-2 text-sm text-fg-bright shadow-lg"
        >
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

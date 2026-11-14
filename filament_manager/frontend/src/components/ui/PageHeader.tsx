// Page title row: title (+ optional subtitle) on the left, actions on the right.
export default function PageHeader({ title, subtitle, actions }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex-none flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

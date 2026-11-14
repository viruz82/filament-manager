// Charts of the overview page; loaded lazily so recharts is not part of the start bundle.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DashboardStats, PrinterEnergy } from '../../types'
import { useCurrencyFormatter, useCurrencySymbol } from '../../hooks/useHATZ'
import { fmtNum } from '../../utils/number'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, CartesianGrid,
} from 'recharts'

// Chart colours come from the theme tokens (follow dark / light and the HA accent);
// only the tail of the palette is fixed.
const tok = (name: string) => `rgb(var(--fm-${name}))`
const PIE_COLORS = [
  tok('accent'), tok('ok'), tok('warn'), tok('extra'), tok('crit'), tok('info'),
  '#06b6d4', '#f97316', '#84cc16', '#ec4899',
]
const AXIS_TICK = { fill: 'var(--fm-text-primary)', fillOpacity: 0.6, fontSize: 11 }
const TT_STYLE = {
  background: tok('surface-3'), border: 'none', borderRadius: 12,
  color: 'var(--fm-text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,.25)',
}
const TT_LABEL = { color: 'var(--fm-text-primary)' }
const TT_ITEM  = { color: 'var(--fm-text-primary)' }

// ── Chart section ─────────────────────────────────────────────────────────────

type ChartTab = 'materials' | 'cost' | 'weight' | 'location' | 'timeline' | 'energy'

export default function ChartSection({ stats }: { stats: DashboardStats }) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const currencySymbol = useCurrencySymbol()
  const [tab, setTab] = useState<ChartTab>('materials')

  const hasEnergy = stats.printer_energy.length > 0

  const TAB_LABELS: { key: ChartTab; label: string }[] = [
    { key: 'materials', label: t('dashboard.tabs.materials') },
    { key: 'cost',      label: t('dashboard.tabs.cost') },
    { key: 'weight',    label: t('dashboard.tabs.weight') },
    { key: 'location',  label: t('dashboard.tabs.location') },
    { key: 'timeline',  label: t('dashboard.tabs.timeline') },
    ...(hasEnergy ? [{ key: 'energy' as ChartTab, label: t('dashboard.tabs.energy') }] : []),
  ]

  const pieData = stats.material_breakdown.map((m, i) => ({
    name: m.material,
    value: m.count,
    kg: m.current_kg,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }))
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0)

  const barColors = [tok('accent'), tok('crit'), tok('ok')]

  const costData = [
    { name: t('dashboard.chart.purchased'), value: stats.total_filament_spent_eur },
    { name: t('dashboard.chart.printed'),   value: +(stats.total_filament_spent_eur - stats.total_available_eur).toFixed(2) },
    { name: t('dashboard.chart.available'), value: stats.total_available_eur },
  ]

  const weightData = [
    { name: t('dashboard.chart.purchased'), value: stats.total_filament_kg },
    { name: t('dashboard.chart.printed'),   value: +(stats.total_filament_kg - stats.total_available_kg).toFixed(3) },
    { name: t('dashboard.chart.available'), value: stats.total_available_kg },
  ]

  const locationData = stats.price_by_location.map((l, i) => ({
    name: l.location,
    avg: l.avg_price,
    count: l.count,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }))

  return (
    <div className="card">
      <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <div className="seg" role="tablist">
          {TAB_LABELS.map(tb => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setTab(tb.key)}
              className={`seg-item ${tab === tb.key ? 'seg-item-on' : 'hover:text-white'}`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'materials' && (
        pieData.length === 0
          ? <p className="text-sm text-gray-500">{t('dashboard.noSpools')}</p>
          : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-52 shrink-0" style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                         innerRadius="58%" outerRadius="95%" paddingAngle={2} stroke="none">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={TT_STYLE} labelStyle={TT_LABEL} itemStyle={TT_ITEM}
                      formatter={(value: number, name: string, props) => [
                        `${value} ${value === 1 ? t('dashboard.chart.spool') : t('dashboard.chart.spools')} · ${fmtNum(props.payload.kg, 2)} ${t('common.kg')}`, name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full min-w-0 grid grid-cols-1 min-[480px]:grid-cols-2 gap-x-6 gap-y-1.5">
                {pieData.map(d => (
                  <li key={d.name} className="flex items-center gap-2 text-sm min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="truncate text-gray-200">{d.name}</span>
                    <span className="ml-auto text-xs text-gray-500 tabular-nums shrink-0">
                      {d.value} · {fmtNum(d.kg, 2)} {t('common.kg')}
                    </span>
                  </li>
                ))}
                <li className="text-xs text-gray-500 col-span-full pt-1">
                  {t('dashboard.spoolCount', { count: pieTotal })}
                </li>
              </ul>
            </div>
          )
      )}

      {tab === 'cost' && (
        stats.total_filament_spent_eur === 0
          ? <p className="text-sm text-gray-500">{t('dashboard.noPurchaseData')}</p>
          : <ResponsiveContainer width="100%" height={240}>
              <BarChart data={costData} barSize={48}>
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TT_STYLE} labelStyle={TT_LABEL} itemStyle={TT_ITEM} cursor={{ fill: 'rgba(128,128,128,0.12)' }} separator="" formatter={(v: number) => [fmtCurrency(v), '']} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {barColors.map((c, i) => <Cell key={i} fill={c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
      )}

      {tab === 'weight' && (
        stats.total_filament_kg === 0
          ? <p className="text-sm text-gray-500">{t('dashboard.noFilamentData')}</p>
          : <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weightData} barSize={48}>
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TT_STYLE} labelStyle={TT_LABEL} itemStyle={TT_ITEM} cursor={{ fill: 'rgba(128,128,128,0.12)' }} separator="" formatter={(v: number) => [`${fmtNum(v, 3)} ${t('common.kg')}`, '']} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {barColors.map((c, i) => <Cell key={i} fill={c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
      )}

      {tab === 'location' && (
        locationData.length === 0
          ? <p className="text-sm text-gray-500">{t('dashboard.noLocationData')}</p>
          : <ResponsiveContainer width="100%" height={240}>
              <BarChart data={locationData} barSize={40}>
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} unit={currencySymbol} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  labelStyle={TT_LABEL}
                  itemStyle={TT_ITEM}
                  cursor={{ fill: 'rgba(128,128,128,0.12)' }}
                  formatter={(v: number, _: string, props) => [
                    `${fmtCurrency(v)} ${t('dashboard.chart.avg')} (${props.payload.count} ${props.payload.count !== 1 ? t('dashboard.chart.spools') : t('dashboard.chart.spool')})`,
                    t('dashboard.chart.avgPrice'),
                  ]}
                />
                <Bar dataKey="avg" radius={[8, 8, 0, 0]}>
                  {locationData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
      )}

      {tab === 'timeline' && (
        stats.prints_per_day.length === 0
          ? <p className="text-sm text-gray-500">{t('dashboard.noPrints')}</p>
          : (() => {
              const data = stats.prints_per_day
              const total = data.length
              const minGap = Math.max(1, Math.floor(total / 24))
              let lastMonth = ''
              const tickFormatter = (dateStr: string, index: number) => {
                if (index % minGap !== 0) return ''
                const month = dateStr.slice(0, 7)
                if (month === lastMonth) return ''
                lastMonth = month
                const d = new Date(dateStr + 'T12:00:00Z')
                return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
              }
              return (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data} barSize={total > 180 ? 2 : total > 60 ? 4 : 8} barCategoryGap={1}>
                    <CartesianGrid vertical={false} stroke="rgba(128,128,128,0.2)" />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={tickFormatter}
                      interval={0}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={24}
                    />
                    <Tooltip
                      contentStyle={TT_STYLE}
                      labelStyle={TT_LABEL}
                      itemStyle={TT_ITEM}
                      cursor={{ fill: 'rgba(128,128,128,0.12)' }}
                      labelFormatter={(label: string) =>
                        new Date(label + 'T12:00:00Z').toLocaleDateString(undefined, {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                        })
                      }
                      formatter={(v: number) => [t('dashboard.chart.prints', { count: v }), '']}
                      separator=""
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {data.map((entry, i) => (
                        <Cell key={i} fill={entry.count === 0 ? 'rgba(128,128,128,0.25)' : tok('accent')} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            })()
      )}

      {tab === 'energy' && (
        (() => {
          const energyData: (PrinterEnergy & { color: string })[] = stats.printer_energy.map((e, i) => ({
            ...e,
            color: PIE_COLORS[i % PIE_COLORS.length],
          }))
          const hasCost = energyData.some(e => e.energy_cost != null)
          return (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={energyData} barSize={hasCost ? 20 : 40}>
                <XAxis dataKey="printer" tick={{ ...AXIS_TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  labelStyle={TT_LABEL}
                  itemStyle={TT_ITEM}
                  cursor={{ fill: 'rgba(128,128,128,0.12)' }}
                  formatter={(v: number, name: string) =>
                    name === 'energy_kwh' ? [`${fmtNum(v, 3)} kWh`, t('dashboard.chart.energyKwh')] : [fmtCurrency(v), t('dashboard.chart.energyCost')]
                  }
                />
                <Bar dataKey="energy_kwh" radius={[8, 8, 0, 0]} name="energy_kwh">
                  {energyData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
                {hasCost && (
                  <Bar dataKey="energy_cost" radius={[8, 8, 0, 0]} name="energy_cost">
                    {energyData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.45} />)}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          )
        })()
      )}

    </div>
  )
}

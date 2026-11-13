export interface Spool {
  id: number
  custom_id: number | null
  brand: string
  material: string
  subtype: string | null
  subtype2: string | null
  color_name: string
  color_hex: string
  color2_hex: string | null
  color3_hex: string | null
  color4_hex: string | null
  diameter_mm: number
  initial_weight_g: number
  current_weight_g: number
  spool_weight_g: number
  purchase_price: number | null
  purchased_at: string | null
  purchase_location: string | null
  storage_location: string | null
  article_number: string | null
  last_dried_at: string | null
  packaging: Packaging | null
  is_drying: boolean
  drying_started_at: string | null
  moisture: MoistureInfo
  ams_slot: string | null
  notes: string | null
  archived: boolean
  is_refill_pack: boolean
  remaining_pct: number
  price_per_kg: number | null
  cost_per_gram: number | null
  created_at: string
  updated_at: string
  bambu_spool_id: string | null
  bambu_synced_at: string | null
}

export type Packaging = 'open' | 'original' | 'sealed' | 'vacuum' | 'drybox'
export const PACKAGING_TYPES: Packaging[] = ['open', 'original', 'sealed', 'vacuum', 'drybox']

export type MoistureLevel = 'dry' | 'good' | 'warning' | 'critical' | 'drying' | 'unknown'

export interface MoistureInfo {
  pct: number | null
  level: MoistureLevel
  storage: Packaging | 'ams' | 'unknown'
  days_since_dried: number | null
}

export interface MoistureSettings {
  material_factors: Record<string, number>
  storage_factors: Record<string, number>
  default_material_factor: number
  multiplier: number
  warning_pct: number
  critical_pct: number
}

export interface UserPrefs {
  timezone_override: string | null
  currency_override: string | null
  country_override: string | null
  low_stock_threshold_pct: number
  almost_empty_threshold_pct: number
  moisture_warning_pct: number
  moisture_critical_pct: number
}

export type SyncMode = 'off' | 'pull' | 'push' | 'bidirectional'

export interface FilamentSyncStatus {
  sync_mode: SyncMode
  enabled: boolean
  last_sync_at: string | null
  total_spools: number
  linked_spools: number
}

export interface SyncMatchSuggestion {
  local_id: number
  local_summary: string
  cloud_id: string
  cloud_summary: string
  cloud_color_hex: string
  local_color_hex: string
  confidence: number
  match_reason: string
  pre_checked: boolean
}

export interface SyncCloudOnly {
  cloud_id: string
  cloud_summary: string
  filament_vendor: string
  filament_type: string
  filament_name: string
  color_hex: string
  initial_weight_g: number
  current_weight_g: number
}

export interface SyncLocalOnly {
  local_id: number
  local_summary: string
  color_hex: string
}

export interface SyncCloudDeleted {
  local_id: number
  local_summary: string
  was_cloud_id: string
}

export interface FilamentSyncPlan {
  already_linked_count: number
  match_suggestions: SyncMatchSuggestion[]
  cloud_only: SyncCloudOnly[]
  local_only: SyncLocalOnly[]
  cloud_deleted: SyncCloudDeleted[]
}

export interface ConfirmedMatch {
  local_id: number
  cloud_id: string
}

export interface DeletedAction {
  local_id: number
  action: 'archive' | 'keep' | 'delete'
}

export interface ApplySyncRequest {
  confirmed_matches: ConfirmedMatch[]
  import_from_cloud: string[]
  push_to_cloud: number[]
  deleted_actions: DeletedAction[]
}

export interface FilamentSyncResult {
  matched: number
  imported: number
  pushed: number
  archived: number
  deleted: number
  errors: number
}

export interface PrintUsage {
  id: number
  print_job_id: number
  spool_id: number
  grams_used: number
  meters_used: number | null
  ams_slot: string | null
  cost: number | null
  spool: Spool | null
}

export interface SuggestedUsage {
  ams_slot: string
  grams: number
  filament_type: string
  color: string | null
  spool_id: number | null
  estimated?: boolean        // true = stock-based split (auto-switch or swap estimate)
  swap_index?: number | null // 0 = original spool (ran out), 1 = replacement spool
}

export interface PrintJob {
  id: number
  name: string
  model_name: string | null
  description: string | null
  started_at: string
  finished_at: string | null
  duration_seconds: number | null
  duration_hours: number | null
  success: boolean
  notes: string | null
  printer_name: string | null
  source: string
  total_grams: number
  total_cost: number
  material_cost: number
  is_test_print: boolean
  usages: PrintUsage[]
  created_at: string
  fm_project_id: number | null
  project_name: string | null
  print_weight_g: number | null
  nozzle_diameter: string | null
  suggested_usages: SuggestedUsage[] | null
  design_title: string | null
  url: string | null
  energy_kwh: number | null
  energy_cost: number | null
  wear_cost: number | null
}

export interface Project {
  id: number
  name: string
  description: string | null
  url: string | null
  print_count: number
  total_duration_seconds: number
  total_cost: number
  total_grams: number
  total_energy_kwh: number | null
  total_energy_cost: number | null
  total_wear_cost: number | null
  nozzle_diameters: string[]
  materials: string[]
  material_usage: { material: string; color_name: string; color_hex: string; grams: number }[]
  date_first: string | null
  date_last: string | null
  created_at: string
  test_print_count: number
  test_total_grams: number
  test_total_cost: number
  test_total_energy_kwh: number | null
  test_total_energy_cost: number | null
  test_total_wear_cost: number | null
}

export interface ProjectDetail extends Project {
  print_jobs: PrintJob[]
}

export interface PrinterConfig {
  id: number
  name: string
  ams_unit_count: number
  is_active: boolean
  auto_deduct: boolean
  bambu_serial: string | null
  bambu_source: string   // always "cloud"
  energy_sensor_entity_id: string | null
  price_sensor_entity_id: string | null
  standby_kwh: number | null
  wear_cost_per_hour: number | null
}

export interface BambuCloudStatus {
  status: 'disconnected' | 'pending_2fa' | 'connected' | 'error'
  email: string | null
  error: string | null
  region: string | null
}

export interface BambuCloudDevice {
  serial: string
  name: string
  model: string
  online: boolean
}

export interface SpoolAuditEntry {
  id: number
  changed_at: string
  action: string
  delta_g: number
  weight_before: number | null
  weight_after: number | null
  print_job_id: number | null
  print_name: string | null
}

export interface BrandSpoolWeight {
  id: number
  brand: string
  spool_weight_g: number
}

export interface FilamentSubtype {
  id: number
  name: string
}

export interface FilamentCatalog {
  id: number
  brand: string
  material: string
  subtype: string | null
  subtype2: string | null
  color_name: string
  color_hex: string
  color2_hex: string | null
  color3_hex: string | null
  color4_hex: string | null
  article_number: string | null
  created_at: string
  updated_at: string
}

export interface AMSTray {
  slot_key: string
  ams_id: number
  tray: number
  ha_material: string | null
  ha_color_hex: string | null
  ha_remaining: string | null
  spool: Spool | null
}


export interface PrinterStatus {
  print_stage: string | null
  print_progress: string | null
  remaining_time: string | null
  nozzle_temp: string | null
  bed_temp: string | null
  current_file: string | null
  print_weight: string | null
  ams_active: string | null
  active_tray: string | null
  [key: string]: string | null
}

export interface MaterialBreakdown {
  material: string
  count: number
  current_kg: number
}

export interface PriceByLocation {
  location: string
  avg_price: number
  count: number
}

export interface PrinterHours {
  printer: string
  hours: number
}

export interface PrinterEnergy {
  printer: string
  energy_kwh: number
  energy_cost: number | null
}

export interface DashboardStats {
  total_spools: number
  active_spools: number
  empty_spools: number
  low_stock_spools: number
  total_filament_kg: number
  total_printed_kg: number
  total_available_kg: number
  total_filament_spent_eur: number
  total_print_cost_eur: number
  total_available_eur: number
  refill_pack_spools: number
  refill_pack_spent_eur: number
  refill_pack_kg: number
  total_prints: number
  material_breakdown: MaterialBreakdown[]
  price_by_location: PriceByLocation[]
  printer_hours: PrinterHours[]
  printer_energy: PrinterEnergy[]
  recent_prints: PrintJob[]
  low_stock: Spool[]
  running_job: PrintJob | null
  prints_per_day: { date: string; count: number }[]
}


// ── Project cost report (selection dialog) ─────────────────────────────────
export interface ReportExtra {
  name: string
  amount: number
}

export interface ProjectReportOptions {
  material: boolean
  energy: boolean
  wear: boolean
  include_tests: boolean
  show_by_material: boolean
  show_print_list: boolean
  extras: ReportExtra[]
}

export interface ProjectReportSummary {
  prints: number
  test_prints: number
  test_prints_excluded: number
  grams: number
  hours: number
  material: number | null
  material_estimated: number | null
  energy: number | null
  energy_kwh: number | null
  wear: number | null
  extras: number
  total: number
  per_print: number | null
  prints_without_kwh: number
}

// ── Maintenance log ──────────────────────────────────────────────────────────

export type MaintenanceLevel = 'ok' | 'soon' | 'due' | 'off' | 'none'

export interface MaintenanceTask {
  id: number
  name: string
  description: string | null
  printer_id: number | null
  printer_name: string | null
  interval_hours: number | null
  interval_days: number | null
  interval_grams: number | null
  enabled: boolean
  template_key: string | null
  sort_order: number
  last_done_at: string
  log_count: number
  hours_since: number
  grams_since: number
  days_since: number
  hours_left: number | null
  grams_left: number | null
  days_left: number | null
  pct: number | null
  level: MaintenanceLevel
}

export interface MaintenanceTaskInput {
  name: string
  description: string | null
  printer_id: number | null
  interval_hours: number | null
  interval_days: number | null
  interval_grams: number | null
  enabled: boolean
  last_done_at?: string
}

export interface MaintenanceLogEntry {
  id: number
  task_id: number
  done_at: string
  note: string | null
  hours_since: number | null
  grams_since: number | null
  days_since: number | null
}

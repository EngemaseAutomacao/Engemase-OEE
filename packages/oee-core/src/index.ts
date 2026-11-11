/**
 * @engemase/oee-core — cálculo de OEE puro (sem I/O, sem relógio do sistema).
 * Ver docs/07-calculo-oee.md.
 */
export type {
  IdealCycleTable,
  Instant,
  Interval,
  MachineState,
  NoCommPolicy,
  OeeIndicators,
  OeeOptions,
  OeeTotals,
  OeeWarning,
  OeeWarningCode,
  PerformanceStatus,
  ProductionDuringPlannedStopPolicy,
  ProductionMinute,
  QualityAdjustment,
  ReasonCategory,
  ScheduledWindow,
  SetupPolicy,
  StateEvent,
} from "./types.js";

export { OeeInputError } from "./errors.js";

export {
  clipInterval,
  clipIntervals,
  intersectIntervals,
  normalizeIntervals,
  subtractIntervals,
  totalDurationMs,
  unionIntervals,
} from "./intervals.js";

export {
  addDays,
  assertTimeZone,
  formatPlainDate,
  isoWeekday,
  localDateTimeToInstant,
  parsePlainDate,
  parseTimeOfDay,
  plantDateOf,
  timeZoneOffsetMs,
  toLocalDateTime,
  zonedDateTimeToInstant,
  type IsoWeekday,
  type LocalDateTime,
  type PlainDateParts,
} from "./timezone.js";

export {
  findShiftWindowAt,
  generateShiftWindows,
  type GenerateShiftWindowsInput,
  type ShiftBreakDefinition,
  type ShiftDefinition,
  type ShiftWindow,
} from "./shifts.js";

export {
  resolveStateTimeline,
  type SegmentCategory,
  type SegmentEffect,
  type StateSegment,
  type TimelineOptions,
} from "./states.js";

export {
  idealCycleFor,
  summarizeCounts,
  type CountSummary,
  type ProductCount,
  type SummarizeCountsInput,
} from "./counts.js";

export {
  computeIndicators,
  DEFAULT_PERFORMANCE_ALERT_THRESHOLD,
  performanceStatus,
} from "./indicators.js";

export { aggregateOee, EMPTY_TOTALS, sumTotals, type OeeSummary } from "./aggregate.js";

export { DEFAULT_OEE_OPTIONS, resolveOptions } from "./options.js";

export {
  calculateMachineOee,
  type MachineOeeInput,
  type MachineOeeResult,
  type TimeBreakdown,
} from "./machine-oee.js";

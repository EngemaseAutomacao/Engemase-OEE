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
} from "./types";

export { OeeInputError } from "./errors";

export {
  clipInterval,
  clipIntervals,
  intersectIntervals,
  normalizeIntervals,
  subtractIntervals,
  totalDurationMs,
  unionIntervals,
} from "./intervals";

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
} from "./timezone";

export {
  findShiftWindowAt,
  generateShiftWindows,
  type GenerateShiftWindowsInput,
  type ShiftBreakDefinition,
  type ShiftDefinition,
  type ShiftWindow,
} from "./shifts";

export {
  resolveStateTimeline,
  type SegmentCategory,
  type SegmentEffect,
  type StateSegment,
  type TimelineOptions,
} from "./states";

export {
  idealCycleFor,
  summarizeCounts,
  type CountSummary,
  type ProductCount,
  type SummarizeCountsInput,
} from "./counts";

export {
  computeIndicators,
  DEFAULT_PERFORMANCE_ALERT_THRESHOLD,
  performanceStatus,
} from "./indicators";

export { aggregateOee, EMPTY_TOTALS, sumTotals, type OeeSummary } from "./aggregate";

export { DEFAULT_OEE_OPTIONS, resolveOptions } from "./options";

export {
  calculateMachineOee,
  type MachineOeeInput,
  type MachineOeeResult,
  type TimeBreakdown,
} from "./machine-oee";

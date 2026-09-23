/** Workers rate-limiting binding (period 60 s in wrangler.jsonc). */
export interface Limiter {limit(input:{key:string}):Promise<{success:boolean}>}
export interface Env {
  DB: D1Database;
  INTAKE: D1Database;
  INFERENCE?: Fetcher;
  ANALYSIS_QUEUE?: Queue<{id:string}>;
  ARCHIVES?: R2Bucket;
  /** Global POST limit (every POST except live-understanding canvas requests, which have LIVE_LIMIT). */
  ABUSE?: Limiter;
  /** Explicit (submit-mode) interpretations and screening: the search budget per client. */
  INFER_LIMIT?: Limiter;
  /** Live-understanding interpretations only: a separate, more generous budget that never spends INFER_LIMIT or ABUSE. */
  LIVE_LIMIT?: Limiter;
  /** Optional burst guard in front of the per-day FAQ interest de-duplication. */
  INTEREST?: Limiter;
  /** Optional challenge limiter (moderation.ts); without it challenges share INFER_LIMIT. */
  CHALLENGE_LIMIT?: Limiter;
  VERIFIER_ORIGIN?: string;
  REAL_PUBLICATION_ENABLED?: string;
  /** 'true' lets real-employer juries run (moderation.ts); anything else keeps them off. */
  JURY_ENABLED?: string;
  /** Secret: JSON list of trustee Ed25519 keys for break-glass exceptions; unset keeps /api/exception at 503. */
  TRUSTEE_KEYS?: string;
  /**
   * Operator secret for the append-only ledgers (/api/ledger/finance, /api/ledger/legal) and for applying a reviewed
   * correction to an employer listing (POST /api/directory/correct, community.ts correctListing). Unset, those routes
   * answer 401.
   */
  ADMIN_TOKEN?: string;
  /**
   * Main-worker-only secret. When set, rate-limit keys, jury seat groups and the per-day FAQ interest digests are HMACs;
   * without it FAQ interest is never counted (an unkeyed digest of an address could be reversed).
   */
  RATE_LIMIT_SECRET?: string;
  /**
   * 'true' lets the publisher add crisis support resources to a reply when the asker's own search, draft or revision
   * matches shared/safety.ts (or screening's self_harm answer). Unset (off) until the privacy policy discloses it.
   */
  CRISIS_RESOURCES_ENABLED?: string;
  /**
   * Optional secret shared with the inference worker. When set, every call through INFERENCE carries it (network.ts
   * CALLER_HEADER); set it here before setting it on the inference worker, which then refuses calls without it.
   */
  INFERENCE_CALLER_SECRET?: string;
  /**
   * 'on' shows the fictional sample employers (companies.kind 'sample') and everything about them: directory, search
   * options, discovery, /c/<slug>, Open Graph images, practice juries and challenges on fixtures. Anything else, including
   * unset, hides them everywhere (owner decision 1: production shows no fictional data). 'on' locally and in tests.
   */
  SAMPLE_EMPLOYERS?: string;
  /**
   * Written accounts publish in batches of at least this many approved accounts per employer and verification type
   * (owner decision 3; production 5). Never below the published policy's retention.minimumBatch. Questionnaire aggregates
   * keep MIN_COHORT_N.
   */
  TESTIMONY_BATCH_MIN?: string;
  /** Service binding to the verifier worker: community employer registration and its public /keys (owner decision 4). */
  VERIFIER?: Fetcher;
  /**
   * Secret shared by the main worker and the verifier. Every call to the verifier's internal routes carries it; it never
   * reaches a browser, a log or a response. Without it (or without VERIFIER) listing a new employer is closed.
   */
  INTERNAL_TOKEN?: string;
  /** Proof-of-work difficulty in leading zero bits for /api/employers (shared/pow.ts powBits; default 20). */
  POW_BITS?: string;
  ENVIRONMENT: string;
  PUBLIC_ORIGIN: string;
  MIN_COHORT_N: string;
  MIN_CLUSTER_N: string;
}

export type ViewId = "overview" | "compare" | "timeline" | "distribution" | "cohort" | "clusters" | "reader" | "discovery";

/**
 * Route decision per question (a Jev Choice, reconciled deterministically). needs_generation shows the nearest evidence
 * view with a notice instead of generated prose; cannot_safely_answer shows nothing and keeps the canvas.
 */
export type RouteId =
  | "metric_view"
  | "comparison"
  | "timeline"
  | "distribution"
  | "cohort"
  | "evidence"
  | "clusters"
  | "existing_faq"
  | "discovery"
  | "needs_generation"
  | "cannot_safely_answer";

export type TopicId =
  | "promotion"
  | "management"
  | "compensation"
  | "workload"
  | "layoffs"
  | "location_policy"
  | "culture"
  | "other";

export type LayerId = "experience" | "claim" | "opinion";

export type TimeframeId = "any" | "last_year" | "before_event" | "after_event";

export interface CompanyRef {
  id: string;
  slug: string;
  name: string;
  kind: "sample" | "real";
  /** 'community': listed by a visitor (POST /api/employers), shown with its domain and labeled as added by the community. */
  origin?: "curated" | "community";
  /** Work-mailbox domains verification accepts for this employer, primary first; absent when none is configured. */
  domains?: string[];
  /**
   * Those of `domains` a visitor supplied (POST /api/employers), in the same order; absent when none. On a curated listing
   * this is a domain attached to it by the community, which the page labels as added by the community.
   */
  communityDomains?: string[];
}

export interface Distribution<T extends string = string> {
  value: T;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface Fork {
  field: string;
  question: string;
  options: Array<{ label: string; id: string; share: number }>;
  /** 'fork': a tentative best reading is applied and alternatives are offered; 'ask': nothing was applied for this field. */
  tier?: "fork" | "ask";
  /** 'meaning': the question hinges on an ambiguous word; each option is one meaning (a typed value of `field`) with Jev's probability. */
  kind?: "meaning";
}

/** A value a deterministic rule selected (whether or not Jev also chose it, so the label never depends on Jev's confidence); the UI labels its chip as inferred. */
export interface InferredValue {
  field: "event";
  value: string;
  label: string;
  /** single_documented_event: the named employer has exactly one documented event of the kind the question names. */
  reason: "single_documented_event";
}

export interface Interpretation {
  source: "jev" | "fallback";
  provider: "workers-ai" | "typesafe-api" | "none";
  model: string;
  promptVersion: string;
  providerFallback: "native_failed" | "circuit_open" | "native_unavailable" | null;
  /** Workers AI gateway key source (e.g. BYOK) when the native provider reported one. */
  keySource?: string | null;
  degraded: boolean;
  latencyMs: number;
  company: Distribution | null;
  compareTo: Distribution | null;
  view: Distribution<ViewId>;
  topic: Distribution<TopicId>;
  cohorts: { fn: string | null; seniority: string | null };
  layer: string | null;
  event: Distribution | null;
  timeframe: TimeframeId;
  wantsTestimony: number;
  clarify: boolean;
  forks: Fork[];
  /** Secondary readings that were NOT applied because confidence was below the secondary threshold. */
  suggestions: Array<{ field: string; key?: string; value: string; label: string; confidence: number }>;
  /** Deterministic spans of applied concepts located in the query text (never model spans, never counts). */
  annotations: Array<{ start: number; end: number; field: string; value: string; label: string }>;
  notes: string[];
  focus: TopicId[];
  /** 'unlisted': the question names an employer we do not list, so nothing is shown in its place. `clarify` marks an open ask. */
  route: RouteId | "unlisted";
  /** Jev's raw route Choice, before deterministic reconciliation; null when no route question was answered. */
  routeChoice?: Distribution<RouteId> | null;
  /** Canonical FAQ spec id derived from the typed interpretation (never from the query text). */
  canonicalQuestion: string | null;
  unlistedEmployer?: { name: string | null } | null;
  compareCohorts?: string[];
  /** Values applied by a deterministic rule (never silently): each stays an editable chip and is labeled as inferred. */
  inferred?: InferredValue[];
  industry?: string|null;
  preferences?: Record<string,'high'|'low'|'any'>;
  salaryDataRequired?: boolean;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface DistributionBand { band: string; share: number }

export interface MetricSeriesPoint {
  period: string;
  /** Always null for distribution metrics: their stored value is not a statistic. */
  value: number | null;
  n: number;
  ciLow: number | null;
  ciHigh: number | null;
  eventId: string | null;
  releaseId: string;
  releaseBatch: string;
  /** Distribution metrics only. */
  bands?: DistributionBand[];
  /** Distribution metrics only: the published median, present only for definitions documented as a median (e.g. weekly hours); null otherwise. */
  median?: number | null;
}

/**
 * fixture = seeded illustrative rows on fictional employers only; sandbox = visitors' demo or earlier demonstration
 * credentials (not employment-verified); credentialed = work-mailbox credential on a real employer;
 * unverified = verification not recorded, never presented as employment-verified.
 */
export type Provenance = "fixture" | "sandbox" | "credentialed" | "unverified";

export interface MetricView {
  key: string;
  label: string;
  question: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better" | "neutral";
  responseType: "percent_agree" | "scale_5" | "distribution" | "number";
  methodNote: string;
  verificationMethod: string;
  provenance: Provenance;
  topic: TopicId | null;
  exclusions: string | null;
  cohortLabel: string;
  series: MetricSeriesPoint[];
  latest: MetricSeriesPoint | null;
  /** Always null for distribution metrics. */
  delta: number | null;
  deltaPeriod: string | null;
  /** Accounts and clusters matching this metric's topic under the page's filters (never unrelated latest accounts). */
  related?: { testimonyIds: string[]; clusterKeys: string[] };
}

/** Deterministic answer assembled from released numbers only; never model prose. */
export interface EvidenceAnswer {
  headline: string;
  facts: Array<{ label: string; value: string; n: number | null; period: string | null; metricKey?: string; releaseId?: string }>;
  /** Published accounts mentioning the topic under the page's filters; null when no topic applies or fewer than 5. */
  accountsMentioning?: { topic: string; count: number } | null;
  route: RouteId;
}

/** One published release, with what the Evidence Lens needs to open it (group, verification method, provenance). */
export interface CohortCell { value: number; n: number; period: string; releaseId: string; cohortLabel: string; verificationMethod: string; provenance: Provenance }

export interface CohortComparisonRow {
  key: string;
  label: string;
  unit: string;
  cohort: CohortCell | null;
  company: CohortCell | null;
  status: "ok" | "cohort_unavailable" | "suppressed";
}

/**
 * Model readings of written accounts per dimension; not votes. A dimension is omitted when it has fewer than 5 confident
 * readings or when any of its positive/negative/mixed cells holds 1 to 4 accounts, so every count shown is 0 or at least 5.
 */
export interface AccountReading { dimension: string; accounts: number; positive: number; negative: number; mixed: number }

export interface SuppressionNote {
  metricKey: string;
  metricLabel: string;
  period: string;
  reason: "cohort_below_minimum" | "complementary_suppression";
}

export type ReadingDimension = "direct_manager" | "executive_management" | "promotion_clarity" | "performance_fairness" | "workload" | "compensation";

/** Descriptive model reading of one published account. Risk signals are never part of it. */
export interface TestimonyReading {
  dimensions: Record<ReadingDimension, { value: "positive" | "negative" | "mixed" | "unknown"; confidence: number }>;
  mentions: string[];
  specificity: "general" | "some_detail" | "specific" | null;
  model: string;
  promptVersion: string;
}

export interface TestimonyItem {
  id: string;
  layer: LayerId;
  body: string;
  period: string | null;
  eventLabel: string | null;
  verificationClass: string;
  provenance: Provenance;
  /** Reporting quarter only (YYYY-Qn). */
  publishedAt: string;
  topics: Array<{ topic: string; stance: string; salience: number }>;
  topicIds: TopicId[];
  relevance?: number;
  reading?: TestimonyReading;
  /** True when the body was replaced because it contains a direct identifier. */
  withheld?: boolean;
  /** Work-mailbox verified accounts only: the employer's verification domains (the mailbox was at one of these). */
  verificationDomains?: string[];
}

export interface ClusterMember {
  id: string;
  body: string;
  period: string | null;
  layer: LayerId;
  provenance: Provenance;
  /** Set when this account was judged a copy of another member; copies never count as extra reporters. */
  duplicateOf: string | null;
}

export interface CorroborationCluster {
  clusterKey: string;
  summary: string;
  /** Distinct non-copy sources whose every pair was judged to describe the same event. */
  reporterCount: number;
  duplicates: number;
  firstReport: string;
  lastReport: string;
  topics: string[];
  sourceIds: string[];
  isSample: boolean;
  provenance: Provenance | "mixed";
  members: ClusterMember[];
}

export interface EventComparisonRow {
  key: string;
  label: string;
  unit: string;
  before: MetricSeriesPoint;
  after: MetricSeriesPoint;
  window: { from: string; to: string };
  /** Other documented events inside the window; the change cannot be attributed to the selected event alone. */
  alsoInWindow: Array<{ id: string; label: string; occurredOn: string | null }>;
}

export interface FaqOverrides {
  topic: TopicId | null;
  view: ViewId;
  cohort: string | null;
  event: string | null;
  layer: LayerId | null;
  timeframe: "any";
}

export interface FaqEntry {
  specId: string;
  question: string;
  overrides: FaqOverrides;
  origin: "starter" | "popular";
  followUps: Array<{ specId: string; question: string; overrides: FaqOverrides }>;
}

export type ComparisonCell =
  | { status: "value"; metricKey: string; period: string; value: number | null; median?: number | null; bands?: DistributionBand[]; n: number; releaseId: string; verificationMethod: string; provenance: Provenance; cohortLabel: string }
  | { status: "not_published" }
  | { status: "different_instrument"; metricKey: string }
  | { status: "group_unavailable"; cohortLabel: string }
  /** The requested before/after filter could not be applied for this employer, so nothing time-scoped is shown. */
  | { status: "filter_not_applied"; reason: string }
  /** Published for this group, but not inside the selected time window. */
  | { status: "outside_timeframe" }
  | { status: "no_matching_period"; latestPeriod: string | null };

export interface ComparisonSide {
  company: CompanyRef;
  cohortLabel: string;
  cohortStatus: EvidencePayload["cohortStatus"];
  timeStatus: EvidencePayload["timeStatus"];
}

export interface ComparisonTable {
  left: ComparisonSide;
  right: ComparisonSide;
  rows: Array<{ key: string; label: string; unit: string; responseType: MetricView["responseType"]; alignedPeriod: string | null; left: ComparisonCell; right: ComparisonCell }>;
  notices: string[];
  suppressed: SuppressionNote[];
}

export interface DiscoveryValue {
  concept: string;
  label: string;
  metricKey: string;
  unit: string;
  measure: "share_agree" | "median" | "value";
  value: number;
  period: string;
  n: number;
  releaseId: string;
  cohortLabel: string;
  verificationMethod: string;
  /** null when no threshold was requested for this concept. */
  meetsThreshold: boolean | null;
}

export interface DiscoveryRow {
  company: CompanyRef & { sector?: string | null };
  kind: "real" | "sample";
  kindLabel: "Real employer" | "Fictional demonstration";
  status: "match" | "insufficient";
  rank: number | null;
  values: DiscoveryValue[];
  missing: Array<{ concept: string; label: string; reason: string }>;
  metrics: MetricView[];
}

export interface DiscoveryResult {
  rows: DiscoveryRow[];
  notices: string[];
  applied: string[];
  unsupported: string[];
}

export interface EvidencePayload {
  company: CompanyRef;
  cohortLabel: string;
  cohortStatus: "all" | "selected" | "unavailable";
  metrics: MetricView[];
  events: Array<{
    id: string;
    slug: string;
    label: string;
    kind: string;
    occurredOn: string | null;
    disclosure: string;
  }>;
  clusters: CorroborationCluster[];
  testimony: TestimonyItem[];
  distribution: {
    metricKey: string;
    label: string;
    unit: string;
    period: string;
    /** Published median, only for definitions documented as a median (weekly hours); null otherwise. */
    median: number | null;
    n: number;
    releaseId: string;
    bands: DistributionBand[];
  } | null;
  coverage: {
    verifiedContributors: number;
    releasesPublished: number;
    periodsCovered: number;
    firstPeriod: string | null;
    lastPeriod: string | null;
    corroboratedClusters: number;
    latestPeriodResponses: number;
  };
  suppressed: SuppressionNote[];
  notices: string[];
  /**
   * 'any': no time filter; 'applied': last_year or a dated before/after filter was applied;
   * 'not_applied': a before/after filter had no documented, dated event, so nothing time-scoped is shown.
   */
  timeStatus: "any" | "applied" | "not_applied";
  /** Metric keys published for this group that the applied time filter excluded. */
  outsideTimeframe: string[];
  /** Reader paging over accounts matching the current filters. Pinned (ranked) accounts are added to page 0 only. */
  testimonyPaging: { page: number; pageSize: number; matching: number; hasMore: boolean };
  /** Evidence-backed canonical questions. Interest counts are never included. */
  trail: FaqEntry[];
  selectedEvent?: {id:string;label:string;occurredOn:string|null} | null;
  comparison?: EventComparisonRow[];
  facets?: {label:string;dimension:string}[];
  /** Cohort view only: the selected group beside the whole employer for the same metrics and periods. */
  cohortComparison?: CohortComparisonRow[];
  accountReadings?: AccountReading[];
  /** Published accounts mentioning the page's topic under its filters; null below 5 or without a topic. */
  accountsMentioning?: { topic: string; count: number } | null;
  generatedAt: string;
}

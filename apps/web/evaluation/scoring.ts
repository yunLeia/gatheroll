export type Metadata = { captured_at: string | null; latitude: number | null; longitude: number | null };
// Optional legacy experiment context, never current product requirements.
export type Event = { event_id: string; starts_at?: string | null; ends_at?: string | null; latitude?: number | null; longitude?: number | null };
export type Config = {
  version: string;
  before_grace_minutes: number; after_grace_minutes: number;
  location_full_meters: number; location_zero_meters: number;
  time_weight: number; location_weight: number;
  select_threshold: number; review_threshold: number;
};
export type State = "selected" | "review" | "excluded";
export type Baseline = "all_selected" | "time_only" | "time_gps";
export const baselines: Baseline[] = ["all_selected", "time_only", "time_gps"];

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (x: number) => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) *
    Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

// Signed distance to the nearest time boundary: before < 0, inside = 0, after > 0.
export function timeDelta(meta: Metadata, event: Event): number | null {
  if (meta.captured_at === null || !event.starts_at || !event.ends_at) return null;
  const t = Date.parse(meta.captured_at), start = Date.parse(event.starts_at), end = Date.parse(event.ends_at);
  return t < start ? (t - start) / 60000 : t > end ? (t - end) / 60000 : 0;
}
export function timeScore(delta: number | null, c: Config): number | null {
  if (delta === null) return null;
  if (delta === 0) return 1;
  const grace = delta < 0 ? c.before_grace_minutes : c.after_grace_minutes;
  return grace === 0 ? 0 : Math.max(0, 1 - Math.abs(delta) / grace);
}
export function locationScore(distance: number | null, c: Config): number | null {
  if (distance === null) return null;
  return Math.max(0, Math.min(1, (c.location_zero_meters - distance) /
    (c.location_zero_meters - c.location_full_meters)));
}
export function decision(score: number | null, c: Config): State {
  if (score === null) return "review";
  return score >= c.select_threshold ? "selected" : score >= c.review_threshold ? "review" : "excluded";
}
export function predict(meta: Metadata, event: Event, c: Config, baseline: Baseline) {
  const delta_minutes = timeDelta(meta, event);
  const distance_meters = meta.latitude !== null && meta.longitude !== null &&
    event.latitude != null && event.longitude != null
    ? haversine(meta.latitude, meta.longitude, event.latitude, event.longitude) : null;
  const time_score = timeScore(delta_minutes, c);
  const location_score = baseline === "time_gps" ? locationScore(distance_meters, c) : null;
  const weight = (time_score === null ? 0 : c.time_weight) + (location_score === null ? 0 : c.location_weight);
  const score = baseline === "all_selected" ? 1 : weight === 0 ? null :
    ((time_score ?? 0) * c.time_weight + (location_score ?? 0) * c.location_weight) / weight;
  return { baseline, score, predicted: baseline === "all_selected" ? "selected" as State : decision(score, c),
    delta_minutes, distance_meters, time_score, location_score,
    available_signals: [time_score !== null ? "time" : null, location_score !== null ? "gps" : null].filter(Boolean) };
}

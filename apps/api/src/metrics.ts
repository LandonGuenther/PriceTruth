/**
 * Process-local counters + duration reservoirs. No external deps; reset never
 * (per-process, so multi-instance deployments need an external aggregator —
 * see docs).
 */

const MAX_SAMPLES = 2048;

type Labels = Record<string, string>;

const labelKey = (labels: Labels): string =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join(",");

export class Metrics {
  private counters = new Map<string, { name: string; labels: Labels; count: number }>();
  private durations = new Map<string, number[]>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}{${labelKey(labels)}}`;
    const c = this.counters.get(key);
    if (c) c.count += by;
    else this.counters.set(key, { name, labels, count: by });
  }

  observe(operation: string, ms: number): void {
    const arr = this.durations.get(operation);
    const v = Math.round(ms * 10) / 10;
    if (!arr) this.durations.set(operation, [v]);
    else if (arr.length < MAX_SAMPLES) arr.push(v);
    else arr[Math.floor(Math.random() * MAX_SAMPLES)] = v; // reservoir
  }

  snapshot(): {
    counters: Array<{ name: string; labels: Labels; count: number }>;
    durations: Array<{ operation: string; count: number; p50: number; p95: number; max: number }>;
  } {
    return {
      counters: [...this.counters.values()].sort((a, b) =>
        labelKey(a.labels).localeCompare(labelKey(b.labels)),
      ),
      durations: [...this.durations.entries()]
        .map(([operation, samples]) => {
          const s = [...samples].sort((a, b) => a - b);
          const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
          return {
            operation,
            count: s.length,
            p50: p(0.5),
            p95: p(0.95),
            max: s[s.length - 1] ?? 0,
          };
        })
        .sort((a, b) => a.operation.localeCompare(b.operation)),
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const c of this.counters.values()) {
      lines.push(`${c.name}{${labelKey(c.labels)}} ${c.count}`);
    }
    for (const d of this.snapshot().durations) {
      lines.push(`request_duration_ms{operation="${d.operation}",quantile="0.5"} ${d.p50}`);
      lines.push(`request_duration_ms{operation="${d.operation}",quantile="0.95"} ${d.p95}`);
      lines.push(`request_duration_ms_count{operation="${d.operation}"} ${d.count}`);
    }
    return lines.join("\n") + "\n";
  }
}

export const metrics = new Metrics();

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  DATABASE_URL,
  amazonObservation,
  describeIfDb,
  makeApp,
  testConfig,
  truncateAll,
} from "./helpers.js";

const TOKEN = "test-internal-token-0123456789abcdef";

describe("internal metrics", () => {
  it("returns counters and durations as JSON", async () => {
    const app = await makeApp();
    await app.inject({ method: "GET", url: "/health" });
    const res = await app.inject({ method: "GET", url: "/internal/metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.counters)).toBe(true);
    expect(Array.isArray(body.durations)).toBe(true);
    expect(
      body.counters.some(
        (c: { name: string; labels: { operation?: string } }) =>
          c.name === "requests_total" && c.labels.operation === "/health",
      ),
    ).toBe(true);
    await app.close();
  });

  it("renders prometheus text format", async () => {
    const app = await makeApp();
    await app.inject({ method: "GET", url: "/health" });
    const res = await app.inject({ method: "GET", url: "/internal/metrics?format=prometheus" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain('requests_total{operation="/health"');
    await app.close();
  });
});

describeIfDb("internal status", () => {
  it("404s when INTERNAL_API_TOKEN is unset", async () => {
    const app = await makeApp(testConfig({ INTERNAL_API_TOKEN: undefined }));
    const res = await app.inject({ method: "GET", url: "/internal/status" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("404s on a wrong token and 200s with the status payload on a correct one", async () => {
    await truncateAll();
    const app = await makeApp(testConfig({ INTERNAL_API_TOKEN: TOKEN }));

    const bad = await app.inject({
      method: "GET",
      url: "/internal/status",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(bad.statusCode).toBe(404);

    const ok = await app.inject({
      method: "GET",
      url: "/internal/status",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body).toHaveProperty("observationsLast24h");
    expect(body.rollup).toHaveProperty("checkpoint");
    expect(body.archive).toHaveProperty("batches");
    expect(body.counts).toHaveProperty("retailers");
    expect(Array.isArray(body.lastJobRuns)).toBe(true);
    await app.close();
  });
});

describeIfDb("ingest outcome logging", () => {
  it("records observations_total by outcome", async () => {
    await truncateAll();
    const app = await makeApp();
    const obs = amazonObservation();
    const res = await app.inject({
      method: "POST",
      url: "/v1/observations",
      headers: { "content-type": "application/json" },
      payload: obs,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("ACCEPTED");

    const metrics = await app.inject({ method: "GET", url: "/internal/metrics" });
    expect(
      metrics
        .json()
        .counters.some(
          (c: { name: string; labels: { outcome?: string } }) =>
            c.name === "observations_total" && c.labels.outcome === "accepted",
        ),
    ).toBe(true);
    await app.close();
  });
});

// Spawns the real entrypoint and sends SIGTERM: an in-flight request completes
// and the process exits 0.
describeIfDb("graceful shutdown", () => {
  it("SIGTERM exits 0 and completes an in-flight request", async () => {
    const port = 3899 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: DATABASE_URL ?? "",
        PORT: String(port),
        NODE_ENV: "test",
        LOG_LEVEL: "info",
        SHUTDOWN_TIMEOUT_MS: "8000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let logs = "";
    child.stdout!.on("data", (d) => (logs += d));
    child.stderr!.on("data", (d) => (logs += d));

    // Wait for listen.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        throw new Error(`server did not start; logs:\n${logs}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // Hold a request genuinely in-flight with Expect: 100-continue: send
    // headers, wait for the 100 interim response (server is processing),
    // SIGTERM, then the body — a drained request must still complete.
    const { Socket } = await import("node:net");
    const obs = amazonObservation();
    const payload = JSON.stringify(obs);
    const sock = new Socket();
    await new Promise<void>((res, rej) => {
      sock.connect(port, "127.0.0.1", res);
      sock.on("error", rej);
    });
    const buf: Buffer[] = [];
    sock.on("data", (d) => buf.push(d));
    sock.write(
      `POST /v1/observations HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n` +
        `Expect: 100-continue\r\n\r\n`,
    );
    // Wait for the 100 Continue interim response.
    const continueDeadline = Date.now() + 10_000;
    for (;;) {
      if (Buffer.concat(buf).includes("100")) break;
      if (Date.now() > continueDeadline) throw new Error("no 100-continue");
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill("SIGTERM");
    sock.write(payload);
    const responseDeadline = Date.now() + 10_000;
    let response = "";
    for (;;) {
      response = Buffer.concat(buf).toString();
      // Two status lines expected: the 100 interim + the final response.
      if ((response.match(/HTTP\/1\.1 \d{3}/g) ?? []).length >= 2) break;
      if (Date.now() > responseDeadline)
        throw new Error(`no response after SIGTERM; got: ${response}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(response).toMatch(/^HTTP\/1\.1 (200|201)/m);
    sock.destroy();

    const exit = await new Promise<{ code: number | null }>((resolveP) => {
      child.on("exit", (code) => resolveP({ code }));
      setTimeout(() => {
        child.kill("SIGKILL");
        resolveP({ code: null });
      }, 12_000);
    });
    expect(exit.code).toBe(0);
    expect(logs).toContain("shutdown requested");
  }, 45_000);
});

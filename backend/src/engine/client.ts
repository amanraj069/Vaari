/**
 * How the API reaches the engine. Two implementations behind one interface:
 * - LocalEngineClient spawns `python -m vaari_engine` with JSON on stdin/stdout (dev and tests);
 * - HttpEngineClient calls the private engine service with the shared-secret header (production).
 * Both validate the engine's answer against the shared Zod contract.
 */
import { spawn } from "node:child_process";
import {
  explainResponseSchema,
  solveResponseSchema,
  type ExplainRequest,
  type ExplainResponse,
  type SolveRequest,
  type SolveResponse,
} from "../shared";
import type { Config } from "../config";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface EngineClient {
  solve(request: SolveRequest): Promise<SolveResponse>;
  explain(request: ExplainRequest): Promise<ExplainResponse>;
}

function parseEngineBody(body: unknown): unknown {
  if (body && typeof body === "object" && "error" in body) {
    const failure = body as { error: string; detail?: unknown };
    throw new EngineError(`engine rejected the request: ${JSON.stringify(failure.detail)}`, failure.error);
  }
  return body;
}

export class LocalEngineClient implements EngineClient {
  constructor(
    private readonly pythonPath: string,
    private readonly engineDirectory: string,
  ) {}

  private run(command: "solve" | "explain", payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, ["-m", "vaari_engine", command], { cwd: this.engineDirectory });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error) => reject(new EngineError(`could not start engine: ${error.message}`, "ENGINE_UNAVAILABLE")));
      child.on("close", () => {
        try {
          resolve(parseEngineBody(JSON.parse(stdout)));
        } catch (error) {
          if (error instanceof EngineError) return reject(error);
          reject(new EngineError(`engine returned no JSON. stderr: ${stderr.slice(-800)}`, "ENGINE_FAILED"));
        }
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  async solve(request: SolveRequest) {
    return solveResponseSchema.parse(await this.run("solve", request));
  }

  async explain(request: ExplainRequest) {
    return explainResponseSchema.parse(await this.run("explain", request));
  }
}

export class HttpEngineClient implements EngineClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
  ) {}

  private async post(path: string, payload: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-engine-secret": this.sharedSecret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = (body as { detail?: { error?: string } } | null)?.detail;
      throw new EngineError(`engine HTTP ${response.status}`, detail?.error ?? "ENGINE_FAILED");
    }
    return parseEngineBody(body);
  }

  async solve(request: SolveRequest) {
    return solveResponseSchema.parse(await this.post("/solve", request));
  }

  async explain(request: ExplainRequest) {
    return explainResponseSchema.parse(await this.post("/explain", request));
  }
}

export function createEngineClient(config: Config): EngineClient {
  return config.ENGINE_MODE === "http"
    ? new HttpEngineClient(config.ENGINE_URL, config.ENGINE_SHARED_SECRET)
    : new LocalEngineClient(config.ENGINE_PYTHON, config.ENGINE_DIR);
}

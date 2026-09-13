import { RpcError } from "@trellis/sdk/rpc";
import type { HandlersFor } from "@trellis/sdk/rpc";
import type { rpcSpec, WeatherReading } from "#rpcSpec";

/**
 * Current conditions from Open-Meteo, a public API needing no key.
 *
 * Server-side rather than a `fetch` in the component, for two reasons that
 * outlive this demo: the desktop webview's origin is `tauri://localhost`, and
 * not every provider's CORS policy accepts it; and a provider that does need
 * a key would need somewhere to keep it that isn't the client bundle.
 *
 * It is *not* here because per-user work belongs on the broker — it doesn't.
 * It's here because it has to work on both hosts, and the browser entry point
 * has no Tauri. See "Backend" in CLAUDE.md.
 */
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Bounded so a hung provider can't pin an RPC call open indefinitely. */
const TIMEOUT_MS = 8000;

/** Open-Meteo's `current` block, as far as we rely on it. */
interface OpenMeteoResponse {
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    wind_speed_10m?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
  };
}

const asNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RpcError("WEATHER_UNAVAILABLE", `provider returned no usable ${field}`);
  }
  return value;
};

export const weatherHandlers: HandlersFor<typeof rpcSpec, "weather"> = {
  "weather.current": async ({ latitude, longitude, place }) => {
    // Validated at runtime: the spec types the caller, the wire enforces
    // nothing, and these go straight into an outbound URL.
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
      throw new RpcError("BAD_REQUEST", "latitude must be a number between -90 and 90");
    }
    if (typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new RpcError("BAD_REQUEST", "longitude must be a number between -180 and 180");
    }
    if (typeof place !== "string" || !place.trim()) {
      throw new RpcError("BAD_REQUEST", "place is required");
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("current", "temperature_2m,wind_speed_10m,weather_code,is_day");
    url.searchParams.set("timezone", "auto");

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (cause) {
      // A network failure is not a bug in the caller — give it a code it can
      // distinguish from a malformed request.
      throw new RpcError(
        "WEATHER_UNAVAILABLE",
        `could not reach the weather provider: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!response.ok) {
      throw new RpcError("WEATHER_UNAVAILABLE", `weather provider returned ${response.status}`);
    }

    const body = (await response.json()) as OpenMeteoResponse;
    const current = body.current;
    if (!current) throw new RpcError("WEATHER_UNAVAILABLE", "provider returned no current conditions");

    const reading: WeatherReading = {
      place: place.trim(),
      temperatureC: asNumber(current.temperature_2m, "temperature"),
      windSpeedKph: asNumber(current.wind_speed_10m, "wind speed"),
      code: asNumber(current.weather_code, "weather code"),
      isDay: current.is_day === 1,
      observedAt: typeof current.time === "string" ? current.time : new Date().toISOString(),
    };
    return reading;
  },
};

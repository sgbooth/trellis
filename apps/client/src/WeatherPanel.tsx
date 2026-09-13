import { useCallback, useEffect, useState } from "react";
import type { PluginComponentProps } from "@trellis/sdk";
import type { WeatherReading } from "#rpcSpec";
import { rpc } from "./rpc.js";

/**
 * Current conditions for San Francisco, fetched through `rpc.weather.current`
 * rather than a `fetch` in this component — see weatherHandlers.ts for why
 * the outbound call lives on the broker.
 *
 * Coordinates are props-shaped constants rather than baked into the handler,
 * so pointing this at another city is a parameter change.
 */
const SAN_FRANCISCO = { latitude: 37.7749, longitude: -122.4194, place: "San Francisco" };

/** WMO weather interpretation codes, grouped — the provider returns a number
 *  and no text. Grouped rather than exhaustive: the bands are what a reader
 *  actually wants, and an unknown code still renders honestly. */
function describeWeather(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return `Unknown (code ${code})`;
}

export const WeatherPanel: React.FC<PluginComponentProps> = ({ host }) => {
  const [reading, setReading] = useState<WeatherReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReading(await rpc.weather.current(SAN_FRANCISCO));
    } catch (cause) {
      // The handler distinguishes BAD_REQUEST from WEATHER_UNAVAILABLE, and
      // both arrive here as the message — worth showing verbatim rather than
      // flattening to "something went wrong".
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!host.realtime) return;
    // async IIFE so a synchronous throw from the rpc proxy becomes a
    // rejection `load`'s own catch actually sees.
    void load();
  }, [host.realtime, load]);

  if (!host.realtime) return null;

  return (
    <section>
      <h3>Weather</h3>
      {error && <p role="alert">Could not load weather: {error}</p>}
      {reading ? (
        <p>
          <strong>{reading.place}</strong>: {describeWeather(reading.code)},{" "}
          {reading.temperatureC.toFixed(1)}°C, wind {reading.windSpeedKph.toFixed(0)} km/h{" "}
          <span style={{ opacity: 0.7 }}>
            ({reading.isDay ? "day" : "night"}, observed {reading.observedAt})
          </span>
        </p>
      ) : (
        !error && <p>{loading ? "Loading…" : "No reading yet."}</p>
      )}
      <button type="button" onClick={() => void load()} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </section>
  );
};

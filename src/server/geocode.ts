import { sqlite } from "./db";
import { env } from "./env";
import { nowIso } from "./time";

type GeocodedLocation = {
  normalizedLocation: string;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
};

const cache = new Map<string, GeocodedLocation | null>();
let lastRequestAt = 0;

function geocodeCacheIsFresh(geocodedAt: string | null | undefined) {
  if (!geocodedAt) return false;
  if (env.geocodingCacheTtlDays <= 0) return true;
  const ttlMs = env.geocodingCacheTtlDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(geocodedAt).getTime() < ttlMs;
}

function inferCountry(address: Record<string, string> | undefined) {
  if (!address) return null;
  return address.country ?? address.state ?? address.city ?? null;
}

async function throttleNominatim() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
  lastRequestAt = Date.now();
}

export async function geocodeLocation(location: string | null): Promise<GeocodedLocation | null> {
  if (!env.geocodingEnabled || env.geocodingProvider !== "nominatim" || !location?.trim()) return null;

  const key = location.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  await throttleNominatim();

  const params = new URLSearchParams({
    q: location,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
    "accept-language": "en"
  });
  if (env.geocodingEmail) params.set("email", env.geocodingEmail);

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      "Accept-Language": "en",
      "User-Agent": env.geocodingEmail ? `starshot (${env.geocodingEmail})` : "starshot"
    }
  });

  if (!response.ok) {
    cache.set(key, null);
    return null;
  }

  const rows = (await response.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    address?: Record<string, string>;
  }>;
  const row = rows[0];

  if (!row) {
    cache.set(key, null);
    return null;
  }

  const result = {
    normalizedLocation: row.display_name,
    country: inferCountry(row.address),
    countryCode: row.address?.country_code?.toUpperCase() ?? null,
    latitude: Number(row.lat),
    longitude: Number(row.lon)
  };
  cache.set(key, result);
  return result;
}

export async function geocodeUserIfNeeded(userId: number, location: string | null) {
  if (!location) return;
  const row = sqlite.prepare("SELECT geocoded_at AS geocodedAt FROM github_users WHERE id = ?").get(userId) as
    | { geocodedAt: string | null }
    | undefined;
  if (geocodeCacheIsFresh(row?.geocodedAt)) return;

  const result = await geocodeLocation(location);
  sqlite
    .prepare(
      `UPDATE github_users
      SET normalized_location = ?,
        country = ?,
        country_code = ?,
        latitude = ?,
        longitude = ?,
        geocoded_at = ?
      WHERE id = ?`
    )
    .run(
      result?.normalizedLocation ?? null,
      result?.country ?? null,
      result?.countryCode ?? null,
      result?.latitude ?? null,
      result?.longitude ?? null,
      nowIso(),
      userId
    );
}

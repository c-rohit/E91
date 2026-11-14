export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface WeatherReading extends Coordinate {
  temperature: number;
  humidity: number;
  windSpeed: number;
  pressure: number;
}

export interface RandomnessDetails {
  coordinates: Coordinate[];
  weather: WeatherReading[];
  seedHash: string;
  source: "environmental seed" | "browser crypto fallback";
  message: string;
}

export interface RandomnessEngine {
  details: RandomnessDetails;
  readonly currentOutput: string;
  next(): Promise<number>;
}

interface WeatherResponse {
  locations: WeatherReading[];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makeCoordinates(timing: number[]): Coordinate[] {
  const seen = new Set<string>();

  return timing.map((sample, index) => {
    let offset = 0;
    let latitude = 0;
    let longitude = 0;
    let key = "";

    do {
      latitude =
        (Math.abs(Math.floor(sample * 1_000_000) + index * 179_423 + offset) %
          1_800_001) /
          10_000 -
        90;
      longitude =
        (Math.abs(
          Math.floor(sample * 3_000_001) + index * 317_117 + offset * 37,
        ) %
          3_600_001) /
          10_000 -
        180;
      key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      offset += 1;
    } while (seen.has(key) && offset < 100);

    seen.add(key);
    return { latitude, longitude };
  });
}

async function getWeather(
  coordinates: Coordinate[],
): Promise<WeatherReading[]> {
  const query = new URLSearchParams({
    latitude: coordinates.map(({ latitude }) => latitude).join(","),
    longitude: coordinates.map(({ longitude }) => longitude).join(","),
  });
  const response = await fetch(`/api/weather?${query.toString()}`);
  const payload = (await response.json()) as WeatherResponse | { error: string };

  if (!response.ok || !("locations" in payload)) {
    const message = "error" in payload ? payload.error : "Weather data unavailable.";
    throw new Error(message);
  }

  if (
    payload.locations.length !== coordinates.length ||
    payload.locations.some((reading) =>
      [
        reading.temperature,
        reading.humidity,
        reading.windSpeed,
        reading.pressure,
      ].some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Weather response was incomplete.");
  }

  return payload.locations;
}

function serializeSeed(input: {
  timing: number[];
  coordinates: Coordinate[];
  weather: WeatherReading[];
  timestamp: string;
}): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(
    JSON.stringify({
      timing: input.timing,
      coordinates: input.coordinates,
      weather: input.weather,
      timestamp: input.timestamp,
    }),
  ));
}

export async function initializeRandomness(): Promise<RandomnessEngine> {
  const timing = Array.from({ length: 5 }, () => performance.now());
  const coordinates = makeCoordinates(timing);
  const timestamp = new Date().toISOString();
  let weather: WeatherReading[] = [];
  let source: RandomnessDetails["source"] = "environmental seed";
  let message = "SHA-256 environmental seed initialized.";
  let seedMaterial: Uint8Array;

  try {
    weather = await getWeather(coordinates);
    seedMaterial = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        serializeSeed({ timing, coordinates, weather, timestamp }),
      ),
    );
  } catch (error) {
    const fallbackSeed = crypto.getRandomValues(new Uint8Array(32));
    seedMaterial = new Uint8Array(
      await crypto.subtle.digest("SHA-256", toArrayBuffer(fallbackSeed)),
    );
    source = "browser crypto fallback";
    message =
      error instanceof Error
        ? `Weather unavailable (${error.message}); using browser cryptographic randomness.`
        : "Weather unavailable; using browser cryptographic randomness.";
  }

  const seedHash = bytesToHex(seedMaterial);
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(seedMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  let counter = 0;
  let lastOutput = "Ready";

  return {
    details: { coordinates, weather, seedHash, source, message },
    get currentOutput() {
      return lastOutput;
    },
    async next() {
      const input = new Uint8Array(16);
      new DataView(input.buffer).setBigUint64(8, BigInt(counter));
      counter += 1;
      const digest = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, toArrayBuffer(input)),
      );
      let value = 0;
      for (let index = 0; index < 6; index += 1) {
        value = value * 256 + digest[index];
      }
      value = value * 32 + (digest[6] >>> 3);
      lastOutput = bytesToHex(digest.subarray(0, 8));
      return value / 9_007_199_254_740_992;
    },
  };
}

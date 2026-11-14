import { NextRequest, NextResponse } from "next/server";

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

export async function GET(request: NextRequest) {
  const latitudeValues = request.nextUrl.searchParams.get("latitude")?.split(",");
  const longitudeValues = request.nextUrl.searchParams.get("longitude")?.split(",");

  if (
    !latitudeValues ||
    !longitudeValues ||
    latitudeValues.length !== 5 ||
    longitudeValues.length !== 5
  ) {
    return NextResponse.json(
      { error: "Exactly five latitude and longitude pairs are required." },
      { status: 400 },
    );
  }

  const coordinates = latitudeValues.map((latitude, index) => ({
    latitude: Number(latitude),
    longitude: Number(longitudeValues[index]),
  }));
  if (
    coordinates.some(
      ({ latitude, longitude }) =>
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180,
    )
  ) {
    return NextResponse.json(
      { error: "Coordinates are outside valid latitude or longitude ranges." },
      { status: 400 },
    );
  }

  const query = new URLSearchParams({
    latitude: latitudeValues.join(","),
    longitude: longitudeValues.join(","),
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure",
  });

  try {
    const response = await fetch(`${WEATHER_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Weather service returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const raw: unknown = await response.json();
    const locations = Array.isArray(raw) ? raw : [raw];
    if (locations.length !== 5) {
      return NextResponse.json(
        { error: "Weather service returned an incomplete location set." },
        { status: 502 },
      );
    }

    const readings = locations.map((location: unknown, index) => {
      if (!location || typeof location !== "object" || !("current" in location)) {
        throw new Error("Weather service returned an invalid location.");
      }
      const current = location.current;
      if (!current || typeof current !== "object") {
        throw new Error("Weather service returned no current measurements.");
      }
      const values = current as Record<string, unknown>;
      const reading = {
        ...coordinates[index],
        temperature: values.temperature_2m,
        humidity: values.relative_humidity_2m,
        windSpeed: values.wind_speed_10m,
        pressure: values.surface_pressure,
      };
      if (
        [
          reading.temperature,
          reading.humidity,
          reading.windSpeed,
          reading.pressure,
        ].some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new Error("Weather service returned incomplete measurements.");
      }
      return reading;
    });

    return NextResponse.json({ locations: readings });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to retrieve environmental data.",
      },
      { status: 502 },
    );
  }
}

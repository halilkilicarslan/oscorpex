import { createTool } from "@voltagent/core";
import { z } from "zod";

// Open-Meteo weather code to human-readable condition mapping.
// Full list: https://open-meteo.com/en/docs#weathervariables
function mapWeatherCode(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Unknown";
}

interface GeocodingResult {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country: string;
  }>;
}

interface WeatherResult {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
}

/**
 * A tool for fetching real-time weather information using the Open-Meteo API.
 * No API key required.
 */
export const weatherTool = createTool({
  name: "getWeather",
  description: "Get the current weather for a specific location",
  parameters: z.object({
    location: z.string().describe("The city or location to get weather for"),
  }),
  execute: async ({ location }) => {
    // Step 1: Geocode the city name to latitude/longitude.
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    const geoResponse = await fetch(geoUrl);

    if (!geoResponse.ok) {
      throw new Error(
        `Geocoding API error: ${geoResponse.status} ${geoResponse.statusText}`
      );
    }

    const geoData = (await geoResponse.json()) as GeocodingResult;

    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(
        `Location "${location}" not found. Please provide a valid city name.`
      );
    }

    const { name, latitude, longitude, country } = geoData.results[0];

    // Step 2: Fetch current weather for the resolved coordinates.
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`;

    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) {
      throw new Error(
        `Weather API error: ${weatherResponse.status} ${weatherResponse.statusText}`
      );
    }

    const weatherData = (await weatherResponse.json()) as WeatherResult;
    const current = weatherData.current;

    const resolvedLocation = `${name}, ${country}`;
    const condition = mapWeatherCode(current.weather_code);

    const weather = {
      location: resolvedLocation,
      temperature: current.temperature_2m,
      condition,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
    };

    return {
      weather,
      message: `Current weather in ${resolvedLocation}: ${weather.temperature}°C and ${condition.toLowerCase()} with ${weather.humidity}% humidity and wind speed of ${weather.windSpeed} km/h.`,
    };
  },
});

/**
 * Parsing a coordinate someone pasted in.
 *
 * The immediate case is Garmin Explore's "copy location", which on a Danish
 * device reads `N 66.939300°  V 53.643149°` — note the **V**, for *Vest*.
 * Treating an unrecognised hemisphere letter as positive would put the pin
 * about 107° of longitude away in Siberia, so the letters are handled
 * explicitly and anything unrecognised is refused rather than guessed at.
 *
 * Beyond that the parser is deliberately liberal: Explore can be switched
 * between decimal degrees, degrees-decimal-minutes and degrees-minutes-seconds,
 * and a coordinate might just as easily arrive from a text message.
 */

export type LatLon = { lat: number; lon: number };

/**
 * Hemisphere letters, including the Nordic and German ones.
 *
 * `V` is Vest (Danish, Norwegian, Swedish) — west. `Ø`/`Ö`/`O` are Øst/Öst/Ost
 * — east. `O` is east in every language that uses it for a compass point; no
 * language uses it for west, so it is safe to accept.
 */
const HEMISPHERES: Record<string, { axis: "lat" | "lon"; sign: 1 | -1 }> = {
  N: { axis: "lat", sign: 1 },
  S: { axis: "lat", sign: -1 },
  E: { axis: "lon", sign: 1 },
  W: { axis: "lon", sign: -1 },
  Ø: { axis: "lon", sign: 1 },
  Ö: { axis: "lon", sign: 1 },
  O: { axis: "lon", sign: 1 },
  V: { axis: "lon", sign: -1 },
};

/**
 * Numbers, allowing a comma decimal separator.
 *
 * Requires digits on both sides of the comma, so the separator in
 * `66.9393, -53.6431` is not mistaken for a decimal point.
 */
const NUMBER = /-?\d+(?:[.,]\d+)?/g;

function toNumber(token: string): number {
  return Number(token.replace(",", "."));
}

/** Combine whichever of degrees, minutes and seconds were given. */
function toDegrees(parts: number[]): number {
  const [deg, min = 0, sec = 0] = parts.map(Math.abs);
  const magnitude = deg + min / 60 + sec / 3600;
  // A leading minus can only sit on the degrees.
  return parts[0] < 0 ? -magnitude : magnitude;
}

export type ParseResult =
  | { ok: true; value: LatLon; swapped: boolean }
  | { ok: false; reason: string };

export function parseCoordinates(input: string): ParseResult {
  const text = (input ?? "").trim();
  if (!text) return { ok: false, reason: "Nothing to read." };

  const upper = text.toUpperCase();

  const letters = [...upper].filter((c) => c in HEMISPHERES);
  if (letters.length !== 0 && letters.length !== 2) {
    return {
      ok: false,
      reason: "Expected two compass letters, like N and W, or none at all.",
    };
  }

  const numbers = (upper.match(NUMBER) ?? []).map(toNumber);
  if (numbers.some((n) => !Number.isFinite(n))) {
    return { ok: false, reason: "Could not read the numbers." };
  }

  // 2 → decimal degrees, 4 → degrees and decimal minutes, 6 → degrees, minutes
  // and seconds. Anything else is not a coordinate pair.
  if (![2, 4, 6].includes(numbers.length)) {
    return {
      ok: false,
      reason:
        numbers.length < 2
          ? "That does not look like a position."
          : "Could not tell which numbers are the latitude and which the longitude.",
    };
  }

  const per = numbers.length / 2;
  let first = toDegrees(numbers.slice(0, per));
  let second = toDegrees(numbers.slice(per));
  let swapped = false;

  if (letters.length === 2) {
    const a = HEMISPHERES[letters[0]];
    const b = HEMISPHERES[letters[1]];
    if (a.axis === b.axis) {
      return { ok: false, reason: "Both compass letters point along the same axis." };
    }

    // The letters say which value is which, so a longitude-first paste is
    // still read correctly.
    if (a.axis === "lon") {
      [first, second] = [second, first];
      swapped = true;
    }
    const latSign = a.axis === "lat" ? a.sign : b.sign;
    const lonSign = a.axis === "lon" ? a.sign : b.sign;
    first = Math.abs(first) * latSign;
    second = Math.abs(second) * lonSign;
  } else if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
    // No letters, and the first value cannot be a latitude — so the pair is
    // the other way round. Only done when it is unambiguous.
    [first, second] = [second, first];
    swapped = true;
  }

  if (!Number.isFinite(first) || first < -90 || first > 90) {
    return { ok: false, reason: "The latitude is outside −90 to 90." };
  }
  if (!Number.isFinite(second) || second < -180 || second > 180) {
    return { ok: false, reason: "The longitude is outside −180 to 180." };
  }

  return { ok: true, value: { lat: first, lon: second }, swapped };
}

/** How the app writes a position back out, for confirmation. */
export function formatLatLon({ lat, lon }: LatLon): string {
  return `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(6)}° ${
    lon >= 0 ? "E" : "W"
  }`;
}

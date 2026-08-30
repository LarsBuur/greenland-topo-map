/**
 * Types for the vendored Leaflet.LinearMeasurement control.
 *
 * Upstream ships no types and is not in @types/leaflet, so these are written
 * from the plugin's own `options` block in index.js.
 */

import "leaflet";

declare module "leaflet" {
  namespace Control {
    interface LinearMeasurementOptions extends ControlOptions {
      /** `metric` gives km / m; `imperial` gives miles / feet. Default imperial. */
      unitSystem?: "imperial" | "metric";
      /** Line and label colour. */
      color?: string;
      /** Colour used for text drawn on top of the line. */
      contrastingColor?: string;
      /** Show a measurement label on the final node too. */
      show_last_node?: boolean;
      /** Show the bearing (azimuth) of each leg. */
      show_azimut?: boolean;
    }

    class LinearMeasurement extends Control {
      constructor(options?: LinearMeasurementOptions);
      options: LinearMeasurementOptions;
    }
  }
}

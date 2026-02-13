import { Dimensions, PixelRatio } from "react-native";

/**
 * Responsive scaling utility.
 *
 * All sizes in the app are authored against a 375 × 812 baseline (iPhone SE / X).
 * On larger or smaller screens the values are proportionally scaled so the UI
 * looks consistent on every device.
 *
 * • `s()`   – scale any horizontal dimension (padding, margin, width, gap, borderRadius, etc.)
 * • `vs()`  – scale any vertical dimension (paddingTop, height, marginBottom, etc.)
 * • `ms()`  – moderate scale for font sizes and icon sizes (scales less aggressively)
 * • `fs()`  – alias for ms() specifically for font sizes (respects user accessibility settings)
 */

const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/**
 * Horizontal scale – proportional to screen width.
 */
export function s(size: number): number {
  return PixelRatio.roundToNearestPixel((SCREEN_WIDTH / BASE_WIDTH) * size);
}

/**
 * Vertical scale – proportional to screen height.
 */
export function vs(size: number): number {
  return PixelRatio.roundToNearestPixel((SCREEN_HEIGHT / BASE_HEIGHT) * size);
}

/**
 * Moderate scale – scales less aggressively.
 * Use for font sizes, icon sizes, and anything that should grow a bit on big
 * screens but not become huge.
 *
 * @param size     The base size authored for 375 width
 * @param factor   0 = no scaling, 1 = full scaling. Default 0.5
 */
export function ms(size: number, factor: number = 0.5): number {
  return PixelRatio.roundToNearestPixel(
    size + (s(size) - size) * factor,
  );
}

/**
 * Font scale – same as ms() but also factors in the user's font-size
 * accessibility setting so we never fight the OS.
 */
export function fs(size: number, factor: number = 0.5): number {
  return PixelRatio.roundToNearestPixel(
    ms(size, factor) * PixelRatio.getFontScale(),
  );
}

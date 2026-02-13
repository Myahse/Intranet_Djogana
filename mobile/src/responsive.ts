import { Dimensions, PixelRatio } from "react-native";


const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");


export function s(size: number): number {
  return PixelRatio.roundToNearestPixel((SCREEN_WIDTH / BASE_WIDTH) * size);
}

export function vs(size: number): number {
  return PixelRatio.roundToNearestPixel((SCREEN_HEIGHT / BASE_HEIGHT) * size);
}

export function ms(size: number, factor: number = 0.5): number {
  return PixelRatio.roundToNearestPixel(
    size + (s(size) - size) * factor,
  );
}

export function fs(size: number, factor: number = 0.5): number {
  return PixelRatio.roundToNearestPixel(
    ms(size, factor) * PixelRatio.getFontScale(),
  );
}

export interface ImageFilters {
  brightness: number;  // CSS % — 100 = normal
  contrast: number;
  saturation: number;
  hue: number;         // degrees, -180 to 180
}

export const DEFAULT_FILTERS: ImageFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
};

export function filtersToCSS(f: ImageFilters): string {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) hue-rotate(${f.hue}deg)`;
}

export const FILTER_PRESETS: { label: string; emoji: string; filters: ImageFilters }[] = [
  { label: 'Normal',  emoji: '◻️', filters: { brightness: 100, contrast: 100, saturation: 100, hue:   0 } },
  { label: 'Vivid',   emoji: '🌈', filters: { brightness: 105, contrast: 112, saturation: 165, hue:   0 } },
  { label: 'Warm',    emoji: '🌅', filters: { brightness: 108, contrast: 105, saturation: 118, hue:  18 } },
  { label: 'Cool',    emoji: '❄️', filters: { brightness: 102, contrast: 106, saturation: 108, hue: -22 } },
  { label: 'Drama',   emoji: '🎭', filters: { brightness:  94, contrast: 148, saturation:  72, hue:   0 } },
  { label: 'Fade',    emoji: '🌫️', filters: { brightness: 118, contrast:  78, saturation:  65, hue:   0 } },
  { label: 'B&W',     emoji: '⬛', filters: { brightness: 100, contrast: 112, saturation:   0, hue:   0 } },
  { label: 'Noir',    emoji: '🎬', filters: { brightness:  85, contrast: 158, saturation:   0, hue:   0 } },
  { label: 'Golden',  emoji: '✨', filters: { brightness: 112, contrast: 106, saturation: 145, hue:  28 } },
  { label: 'Pastel',  emoji: '🍬', filters: { brightness: 122, contrast:  86, saturation:  58, hue:   0 } },
  { label: 'Punch',   emoji: '💥', filters: { brightness:  98, contrast: 128, saturation: 175, hue:   0 } },
  { label: 'Dusk',    emoji: '🌆', filters: { brightness:  92, contrast: 110, saturation: 125, hue: -12 } },
];

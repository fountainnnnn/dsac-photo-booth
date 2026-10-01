import type { ChromaKeySettings } from '@/types/scene';

/**
 * Keying out a green (or blue) screen, by colour, in the browser.
 *
 * A screen is never one colour. Shadows, creases and the light falling off
 * towards its edges give it a dozen shades of green, and a keyer that compares
 * against one exact green either leaves the shadows behind or eats into the
 * people. So it compares *how green* a pixel is rather than which green:
 *
 *     dominance = (g - max(r, b)) / g
 *
 * the share of the pixel's green that the other two channels do not also have.
 * A shadow darkens all three together and leaves this almost unchanged; skin,
 * hair and nearly all clothing have none at all. A pixel is screen when its
 * dominance comes close to the screen's own.
 *
 * With a clean plate — a frame of the empty screen taken at setup — "the
 * screen's own" is read per pixel, from the same spot on the plate, so a dim
 * corner is compared with its dim self.
 *
 * The maths lives here twice: once as plain TypeScript, which the tests run,
 * and once as the GLSL below, which the booth runs. They are kept line for
 * line alike.
 */

export type Rgb = [number, number, number];

/** `#rrggbb` to 0–1 channels. Anything unparseable is the default green. */
export function parseHexColour(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? Number.parseInt(m[1], 16) : 0x00b140;
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

/** True when the screen is blue rather than green, so the channels swap. */
export function isBlueScreen(key: Rgb): boolean {
  return key[2] > key[1];
}

/** Swap green and blue, for a blue screen. Its own inverse. */
function swizzle([r, g, b]: Rgb, blue: boolean): Rgb {
  return blue ? [r, b, g] : [r, g, b];
}

/** How green a pixel is, as a share of its green. See the note above. */
export function dominance([r, g, b]: Rgb): number {
  return (g - Math.max(r, b)) / Math.max(g, 1e-4);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Below this a plate pixel is not screen — the room past its edge, or a stand
 * in front of it — and the key colour is used there instead.
 */
const PLATE_MIN_DOMINANCE = 0.15;

/**
 * One pixel: how much of it is person (alpha, 1 = all person) and its colour
 * with the screen's green cast taken back off.
 */
export function keyPixel(
  pixel: Rgb,
  key: Rgb,
  { tolerance, softness, spill }: Pick<ChromaKeySettings, 'tolerance' | 'softness' | 'spill'>,
  plate?: Rgb | null,
): { rgb: Rgb; alpha: number } {
  const blue = isBlueScreen(key);
  const c = swizzle(pixel, blue);

  let ref = dominance(swizzle(key, blue));
  if (plate) {
    const p = dominance(swizzle(plate, blue));
    if (p > PLATE_MIN_DOMINANCE) ref = p;
  }

  const ratio = dominance(c) / Math.max(ref, 1e-4);
  let screen = smoothstep(1 - tolerance - softness, 1 - tolerance, ratio);
  // Near black there is too little colour to judge, and noise there reads as
  // anything at all. Keep it: dark hair is far more common than black screen.
  screen *= smoothstep(0.03, 0.1, c[1]);
  const alpha = 1 - screen;

  const m = Math.max(c[0], c[2]);
  const g = c[1] > m ? c[1] + (m - c[1]) * spill : c[1];
  return { rgb: swizzle([c[0], g, c[2]], blue), alpha };
}

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Line for line the same as keyPixel above.
const FRAGMENT = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_plate;
uniform bool u_hasPlate;
uniform bool u_blue;
uniform vec3 u_key;
uniform float u_tolerance;
uniform float u_softness;
uniform float u_spill;

float dominance(vec3 c) {
  return (c.g - max(c.r, c.b)) / max(c.g, 0.0001);
}

void main() {
  vec3 c = texture2D(u_video, v_uv).rgb;
  vec3 key = u_key;
  if (u_blue) { c = c.rbg; key = key.rbg; }

  float ref = dominance(key);
  if (u_hasPlate) {
    vec3 p = texture2D(u_plate, v_uv).rgb;
    if (u_blue) p = p.rbg;
    float pd = dominance(p);
    if (pd > ${PLATE_MIN_DOMINANCE.toFixed(2)}) ref = pd;
  }

  float ratio = dominance(c) / max(ref, 0.0001);
  float screen = smoothstep(1.0 - u_tolerance - u_softness, 1.0 - u_tolerance, ratio);
  screen *= smoothstep(0.03, 0.1, c.g);
  float alpha = 1.0 - screen;

  float m = max(c.r, c.b);
  if (c.g > m) c.g = c.g + (m - c.g) * u_spill;
  if (u_blue) c = c.rbg;

  // Premultiplied, which is what a WebGL canvas composites as by default.
  gl_FragColor = vec4(c * alpha, alpha);
}`;

type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

function sourceSize(s: Source): { w: number; h: number } {
  if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
  if (s instanceof HTMLImageElement) return { w: s.naturalWidth, h: s.naturalHeight };
  return { w: s.width, h: s.height };
}

/**
 * The keyer, on the graphics chip. One per page, reused every frame: the
 * per-pixel work is trivial, so even a weak laptop's integrated graphics keeps
 * up with a live preview.
 *
 * The output is a canvas the shape of the camera, with the screen transparent,
 * which `drawPhoto` then crops, mirrors and places exactly as it would the
 * camera itself.
 */
export class ChromaKeyer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private videoTex: WebGLTexture;
  private plateTex: WebGLTexture;
  private hasPlate = false;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  /** Null where WebGL is unavailable; the caller then shows the plain camera. */
  static create(): ChromaKeyer | null {
    try {
      return new ChromaKeyer();
    } catch (err) {
      console.warn('[booth] Green-screen keying unavailable:', err);
      return null;
    }
  }

  private constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', {
      premultipliedAlpha: true,
      // Kept so the frame can still be read after the browser has composited.
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('No WebGL');
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed');
      }
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    }
    this.program = program;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['u_video', 'u_plate', 'u_hasPlate', 'u_blue', 'u_key',
      'u_tolerance', 'u_softness', 'u_spill']) {
      this.loc[name] = gl.getUniformLocation(program, name);
    }

    const texture = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      // Video is rarely a power of two, which WebGL 1 allows only with these.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.videoTex = texture(0);
    this.plateTex = texture(1);
    gl.uniform1i(this.loc.u_video, 0);
    gl.uniform1i(this.loc.u_plate, 1);
  }

  /** The empty screen, or null to compare against the key colour alone. */
  setPlate(plate: HTMLImageElement | HTMLCanvasElement | null) {
    const gl = this.gl;
    this.hasPlate = Boolean(plate);
    if (!plate) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plate);
  }

  /**
   * Key one frame. `maxWidth` caps the work for the live preview, which never
   * needs the camera's full resolution; the shutter passes Infinity.
   *
   * Returns the keyer's own canvas, which the next call overwrites — copy it
   * if it has to outlive the frame.
   */
  process(source: Source, settings: ChromaKeySettings, maxWidth = Infinity): HTMLCanvasElement | null {
    const { w, h } = sourceSize(source);
    if (!w || !h) return null;
    const scale = Math.min(1, maxWidth / w);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;

    const gl = this.gl;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const key = parseHexColour(settings.colour);
    gl.uniform3f(this.loc.u_key, key[0], key[1], key[2]);
    gl.uniform1i(this.loc.u_blue, isBlueScreen(key) ? 1 : 0);
    gl.uniform1i(this.loc.u_hasPlate, this.hasPlate ? 1 : 0);
    gl.uniform1f(this.loc.u_tolerance, settings.tolerance);
    gl.uniform1f(this.loc.u_softness, Math.max(0.005, settings.softness));
    gl.uniform1f(this.loc.u_spill, settings.spill);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

/**
 * The colour of the empty screen in a clean plate: the average of its
 * greenest pixels, so the room past the screen's edge does not drag it off.
 * Null when the plate does not look like a screen at all.
 */
export function plateKeyColour(data: Uint8ClampedArray): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const px: Rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    const blueish = px[2] > px[1];
    if (dominance(swizzle(px, blueish)) < 0.3) continue;
    r += px[0]; g += px[1]; b += px[2]; n += 1;
  }
  if (n < data.length / 4 / 20) return null; // under 5% screen: not a plate
  const hex = (v: number) => Math.round((v / n) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

#ifdef GL_ES
precision mediump float; // precision for all floats in this shader
#endif

varying vec2 vTexCoord;

uniform sampler2D u_texture; // own texture must be manually passed in as a uniform
uniform sampler2D u_mask; // own texture must be manually passed in as a uniform
uniform vec2 u_resolution;
uniform float u_clock;
uniform float u_energy;

float random (in vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))
                 * 43758.5453123);
}

float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    // Smooth Interpolation

    // Cubic Hermine Curve.
    //vec2 u = f*f*(3.0-2.0*f);
    // quintic version
    vec2 u = f*f*f*(f*(f*6.-15.)+10.);

    // Mix 4 coorners percentages
    float r = mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y - 0.5;
    return r * r * r;
}

float softnoise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    // Smooth Interpolation

    // Cubic Hermine Curve.
    //vec2 u = f*f*(3.0-2.0*f);
    // quintic version
    vec2 u = f*f*f*(f*(f*6.-15.)+10.);

    // Mix 4 coorners percentages
    float r = mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
    return r;
}

void main() {
    vec2 uv = vTexCoord;
    uv.y = 1.0 - uv.y; // the texture is loaded upside down by default and must be flipped
    vec4 color = texture2D(u_texture, uv);
    vec4 maskColor = texture2D(u_mask, uv);
    float flicker = .025; // clock multiplier for the chromatic aberation
    float wave = .01; // clock multiplier for the inhibitor
    float e = u_energy / 3.0;

    // perlin chroma behavior
    vec2 xClock = vec2(u_clock * flicker, 0.0);
    vec2 yClock = vec2(0.0, u_clock * flicker);

    // scaled version of the uv coordinate
    vec2 uvmini = uv * (u_resolution / 30.0);
    vec2 uvmini2 = uv * (u_resolution / 300.0);

    // pairs of x and y offsets for each color component, each fluctuating with a unique pool of perline noise
    float xr = (noise(uvmini * 1.1 + xClock) + noise(uvmini - xClock + 1.0) + noise(uvmini * 1.1 + yClock + 2.0) + noise(uvmini - yClock + 3.0));
    float yr = (noise(uvmini + xClock + 4.0) + noise(uvmini * 0.9 - xClock + 5.0) + noise(uvmini + yClock + 6.0) + noise(uvmini * 0.9 - yClock + 7.0));
    float xg = (noise(uvmini + xClock + 8.0) + noise(uvmini - xClock + 9.0) + noise(uvmini + yClock + 10.0) + noise(uvmini - yClock + 11.0));
    float yg = (noise(uvmini * 0.9 + xClock + 12.0) + noise(uvmini * 1.1 - xClock + 13.0) + noise(uvmini + yClock + 14.0) + noise(uvmini * 1.1 - yClock + 15.0));
    float xb = (noise(uvmini + xClock + 16.0) + noise(uvmini * 1.1 - xClock + 17.0) + noise(uvmini + yClock + 18.0) + noise(uvmini - yClock + 19.0));
    float yb = (noise(uvmini + xClock + 20.0) + noise(uvmini - xClock + 21.0) + noise(uvmini * 0.9 + yClock + 22.0) + noise(uvmini * 1.1 - yClock + 23.0));

    // master inhibitor for the effect on even more perlin noise
    xClock = vec2(u_clock * wave, 0.0);
    yClock = vec2(0.0, u_clock * wave);
    float inhibit = max((softnoise(uvmini2 + xClock + 24.0) + softnoise(uvmini2 * 1.1 - xClock + 25.0) + softnoise(uvmini2 * 0.9 + yClock + 26.0) + softnoise(uvmini2 - yClock + 27.0)
         - 1.2) / 2.0, // change these to adjust the distribution
         0.0) * u_energy * 7.0; // change the last number to adjust the strength of the aberation

    // chromatically distort but also preserve non-zero alpha pixels
    color.r += (1.0 - color.a) * texture2D(u_texture, uv + vec2(xr, yr) * inhibit / u_resolution).r;
    color.g += (1.0 - color.a) * texture2D(u_texture, uv + vec2(xg, yg) * inhibit / u_resolution).g;
    color.b += (1.0 - color.a) * texture2D(u_texture, uv + vec2(xb, yb) * inhibit / u_resolution).b;
    

    // for some reason the text still shows up when i set its alpha to 0, i think it has to do with the lack of premultiplied alpha or something
    // instead of that method, i just make the text adopt the color of whatever it's on top of if it's not on top of dark blue
    // it starts to tint the text if there are any red or green components, but it's not bad. gives me more flexibility with the glow effect
    float mask = min(maskColor.r + maskColor.g + (1.0 - maskColor.a), 1.0); // this is 0 only when the text is on top of dark blue
    color = color * (1.0 - mask) + maskColor * mask; // mask is 0 or 1

    gl_FragColor = color;
}
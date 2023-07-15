#ifdef GL_ES
precision mediump float; // precision for all floats in this shader
#endif

varying vec2 vTexCoord;

uniform sampler2D u_texture;
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
    float result = mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
    return result * result - .2; // square and slightly bi-polarize the noise
}

void main() {
    vec2 uv = vTexCoord;    
    uv.y = 1.0 - uv.y; // the texture is loaded upside down by default and must be flipped
    vec4 color = texture2D(u_texture, uv);
    vec2 xClock = vec2(u_clock, 0.0);
    vec2 yClock = vec2(0.0, u_clock);
    uv *= u_resolution / 400.0; // zoom the effect
    float tint = (noise(uv + xClock) + noise(uv * 1.1 - xClock + 1.0) + noise(uv * .9 + yClock + 2.0) + noise(uv - yClock + 3.0)) * 0.02 * u_energy;
    color.rgb +=  tint;

    gl_FragColor = color;
}
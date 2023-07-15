#ifdef GL_ES
precision mediump float; // precision for all floats in this shader
#endif

attribute vec3 aPosition;
attribute vec2 aTexCoord;

varying vec2 vTexCoord;

void main() {
  // z must be > 0 for other canvas items to be visible
  // w is scale/zoom, bigger numbers zoom out
  vec4 positionVec4 = vec4(aPosition.xy, 1.0, 1.0);

  // p5.js is a little weird and you have to reposition the vertices here
  positionVec4.xy = positionVec4.xy * 2.0 - 1.0;

  gl_Position = positionVec4;
  
  // pass texCoord to fragment shader
  vTexCoord = aTexCoord;
}
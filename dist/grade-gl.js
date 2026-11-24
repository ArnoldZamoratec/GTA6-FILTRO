// Gradación de color en una sola pasada de GPU. El lienzo de grabación compone
// el resultado con el HUD vectorial. Sin WebGL se usa la gradación de Canvas 2D.
// Incluye realce de nitidez, curva de tono cinematográfica y viñeta suave.
const vertex = 'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
const fragment = `
varying vec2 uv;
uniform sampler2D frame;
uniform vec4 crop;
uniform vec2 texel;
uniform float intensity;
uniform float sharpen;
uniform int look;
vec3 filmic(vec3 c){ c=clamp(c,0.,1.); return mix(c,c*c*(3.-2.*c),.5); }
void main(){
  vec2 st=crop.xy+uv*crop.zw;
  vec3 raw=texture2D(frame,st).rgb;
  // Realce de nitidez (máscara de enfoque en cruz).
  vec3 blur=(texture2D(frame,st+vec2(texel.x,0.)).rgb+texture2D(frame,st-vec2(texel.x,0.)).rgb+
             texture2D(frame,st+vec2(0.,texel.y)).rgb+texture2D(frame,st-vec2(0.,texel.y)).rgb)*.25;
  vec3 crisp=clamp(raw+(raw-blur)*sharpen,0.,1.);
  float l=dot(crisp,vec3(.2126,.7152,.0722));
  vec3 color;
  if(look==2){
    color=(vec3(l)-.5)*1.18+.5;
    color=mix(color,color*vec3(.96,.99,1.05),.6);
  }else if(look==1){
    vec3 hue=mix(vec3(1.17,.83,1.15),vec3(.76,1.14,1.15),smoothstep(.15,1.28,uv.x+.38*uv.y));
    color=mix(vec3(l),crisp,1.2)*hue+vec3(.021,.004,.028);
  }else if(look==3){
    color=mix(vec3(l),crisp,1.06);
  }else{
    // Atardecer: sombras turquesa, luces cálidas (estilo cine de Florida).
    vec3 shadows=vec3(.93,1.01,1.07), lights=vec3(1.09,1.0,.88);
    color=mix(vec3(l),crisp,1.14)*mix(shadows,lights,smoothstep(.08,.85,l))+vec3(.016,.006,.008);
  }
  color=mix(color,filmic(color),look==3?.45:.7);
  vec2 d=(uv-.5)*vec2(1.,.86);
  color*=1.-(look==3?.16:.26)*smoothstep(.32,.78,length(d));
  gl_FragColor=vec4(mix(crisp,clamp(color,0.,1.),intensity),1.);
}`;
const lookIndex = { sunset: 0, neon: 1, noir: 2, natural: 3 };
export function createGrader() {
  try {
    const surface = document.createElement('canvas');
    const gl = surface.getContext('webgl', { alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:'high-performance' });
    if (!gl) return null;
    const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const precision = high && high.precision > 0 ? 'precision highp float;' : 'precision mediump float;';
    function shader(kind, source) {
      const s=gl.createShader(kind); gl.shaderSource(s,source); gl.compileShader(s);
      if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error('Shader unavailable');
      return s;
    }
    const prog=gl.createProgram();
    gl.attachShader(prog,shader(gl.VERTEX_SHADER,vertex)); gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,precision+fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog,gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(prog,'position');
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
    for (const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,wrap,gl.CLAMP_TO_EDGE);
    for (const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    const u = name => gl.getUniformLocation(prog,name);
    const crop=u('crop'), strength=u('intensity'), look=u('look'), texel=u('texel'), sharpen=u('sharpen');
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    const maxView = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096,4096];
    let previousWidth=0, previousHeight=0, previousSource=null;
    const grade = (source,w,h,mirror,settings) => {
      if (gl.isContextLost()) return null;
      const sw=source.videoWidth||source.width, sh=source.videoHeight||source.height;
      if (!sw || !sh || sw>maxTexture || sh>maxTexture || w>maxView[0] || h>maxView[1]) return null;
      if (surface.width!==w || surface.height!==h){surface.width=w;surface.height=h;}
      gl.viewport(0,0,w,h);
      const factor=Math.max(w/sw,h/sh);
      const cu=w/(sw*factor), cv=h/(sh*factor);
      gl.uniform4f(crop,(1-cu)/2+(mirror?cu:0),(1-cv)/2,mirror?-cu:cu,cv);
      gl.uniform2f(texel,1/sw,1/sh);
      // Más realce cuando la salida conserva los píxeles de la cámara.
      gl.uniform1f(sharpen,Math.max(0,Math.min(.55,.55*factor)));
      gl.uniform1f(strength,settings.strength/100);
      gl.uniform1i(look,lookIndex[settings.look] ?? 0);
      if (sw !== previousWidth || sh !== previousHeight || source !== previousSource) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);
        previousWidth=sw; previousHeight=sh; previousSource=source;
      } else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGB,gl.UNSIGNED_BYTE,source);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      return surface;
    };
    grade.maxEdge = Math.min(maxTexture, maxView[0], maxView[1]);
    return grade;
  } catch { return null; }
}

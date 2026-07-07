import{S as e}from"./index-w4-PUCME.js";const d="fogVertexDeclaration",n=`#ifdef FOG
varying vec3 vFogDistance;
#endif
`;e.IncludesShadersStore[d]||(e.IncludesShadersStore[d]=n);const o="fogVertex",i=`#ifdef FOG
vFogDistance=(view*worldPos).xyz;
#endif
`;e.IncludesShadersStore[o]||(e.IncludesShadersStore[o]=i);const r="vertexColorMixing",s=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
vColor=vec4(1.0);
#ifdef VERTEXCOLOR
#ifdef VERTEXALPHA
vColor*=colorUpdated;
#else
vColor.rgb*=colorUpdated.rgb;
#endif
#endif
#ifdef INSTANCESCOLOR
vColor*=instanceColor;
#endif
#endif
`;e.IncludesShadersStore[r]||(e.IncludesShadersStore[r]=s);

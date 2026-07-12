// flightverse/three.js — shim: el juego entero importa three DESDE AQUÍ.
// Hoy apunta a r180 (requisito duro de Spark >=r179); los visores legacy
// (tresd/share/splatview, GS3D 0.4.7) siguen en /vendor/three.module.js r160.
// Ninguna página carga ambos three a la vez.
export * from '/vendor/three180.module.js';

// Pássaros jogáveis. Os multiplicadores mudam como cada um voa.
// orient: rotação (x, y, z) que deixa o modelo olhando para +Z, de pé.
export const BIRDS = [
  {
    id: "hawk",
    name: "Gavião",
    file: "/models/birds/hawk.glb",
    blurb: "Esqueleto completo: ombro, antebraço e mão seguem o seu braço. Equilibrado.",
    speed: 1, turn: 1, climb: 1,
    orient: [0, Math.PI, 0],
    rig: "bones",
    bones: ["Wing", "Wing001", "Wing002"],
    boneLeft: "L", boneRight: "R",
    wing: { cover: 0x8a4f2a, flight: 0x6b3b1f, tip: 0x3a3230, beak: 0xd9b23a },
  },
  {
    id: "seagull",
    name: "Gaivota",
    file: "/models/birds/seagull.glb",
    blurb: "Planadora do mar. Afunda devagar e perdoa erros.",
    speed: 0.95, turn: 0.9, climb: 1.15,
    orient: [0, -Math.PI / 2, 0],
    rig: "bend",
    bendAxis: "z", bendFrom: 6, bendTo: 16, bendSign: 1, restElev: 0.45,
    wing: { cover: 0xf2f2ef, flight: 0xdedfe0, tip: 0x4a4f4f, beak: 0xe0a030 },
  },
  {
    id: "udu",
    name: "Udu",
    file: "/models/birds/songbird.glb",
    blurb: "Pequeno e ágil. Curva fechado, faz manobra rápida.",
    speed: 1.1, turn: 1.45, climb: 1.05,
    orient: [0.75, 0, 0],
    rig: "pieces",
    pieceLeft: "lwing", pieceRight: "rwing",
    wing: { cover: 0x3fc4c6, flight: 0x2a9ea3, tip: 0x3d6fd0, beak: 0xe0d060 },
  },
];

export const BIRD_SPAN = 4.2;
// Porta do rastreador; ?ws=8766 na URL troca (útil para testes).
export const WS_URL = `ws://127.0.0.1:${new URLSearchParams(location.search).get("ws") || 8765}`;

// Modelos CC-BY 3.0 (poly.pizza) — atribuição obrigatória.
export const CREDITS = "Modelos: “Hawk Lp Rigged” por Sherkiz · “Flying seagull” por Poly by Google · “bird” por Kelli Ray — CC-BY 3.0, via poly.pizza. Natureza: Kenney (CC0).";

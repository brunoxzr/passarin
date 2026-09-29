# adepassaro

Jogo de voo controlado pelo corpo inteiro. A webcam lê seus braços, cabeça e tronco, e você vira um pássaro: acorda no chão em primeira pessoa, bate as asas para decolar e voa por um vale atravessando anéis dourados.

## Como rodar

Precisa de **Python 3.11** e **Node.js 18+**.

```bash
python run.py            # rastreador (webcam) + jogo no navegador
python run.py --demo     # sem webcam: pose sintética
python run.py --camera 1 # outra webcam
```

Na primeira vez o `run.py` cria o `.venv`, instala as dependências (MediaPipe, OpenCV, websockets), roda `npm install` e baixa o modelo de pose. Depois abre o navegador em `http://127.0.0.1:5173`.

Sem rastreador também dá para jogar pelo teclado e mouse (veja abaixo).

## Como voar

| Gesto | O que acontece |
|---|---|
| Subir e descer os braços (bater asa) | Impulso para cima, em qualquer altura do braço |
| Braços no alto | Sobe |
| Braços esticados na vertical | Sobe "retão" |
| Um braço mais alto que o outro | Curva. Bem inclinado = curva fechada; no máximo = parafuso |
| Braços cruzados no peito (pose de tobogã) | Mergulha. Olhar para baixo deixa mais fundo |
| Braços apontando para frente e para baixo | Mergulha, mais íngreme quanto mais para baixo |
| Braços abertos parados | Plana, descendo bem devagar |
| Virar a cabeça (no chão) | Olha ao redor em primeira pessoa |

Bater forte em montanha, árvore, pedra, ilha flutuante ou água mata. Rasante suave no chão, não.

**Teclado e mouse:** mouse olha · `Espaço` decola/pula a abertura · `E` bate asa · `W` empina · `S` mergulha · `A` `D` viram · `V` câmera de frente · `C` recalibra no ar · `Esc` pausa · `F3` diagnóstico.

## Modos

- **Jogar**: abertura em primeira pessoa (acordando), decolagem e percurso de 28 anéis com cronômetro e recorde por pássaro.
- **Virar pássaro**: espelho. O pássaro flutua de frente para você copiando o corpo, com a visão dele num canto.
- **Pássaros**: Gavião (esqueleto completo: ombro, antebraço e mão seguem o braço), Gaivota (planadora) e Udu (ágil).

## Estrutura

```
run.py                  sobe rastreador + servidor web
requirements.txt
tracker/                Python: webcam → postura → WebSocket (ws://127.0.0.1:8765)
  pose_server.py        servidor WebSocket e argumentos
  capture.py            webcam + MediaPipe
  kinematics.py         ângulos, vetores 3D do braço, cabeça, suavização
  demo.py               pose sintética (--demo)
  shared.py             estado entre threads
web/                    jogo (Vite + three.js)
  index.html
  public/models/        pássaros (birds/) e natureza (nature/)
  src/
    main.js             loop, telas, ligação de tudo
    config.js           pássaros e constantes
    world/              terreno, ambiente, vegetação, anéis, bando
    bird/               modelo, física de voo, asas em primeira pessoa
    camera/             câmera 1ª/3ª pessoa e menu
    game/intro.js       abertura (olhos abrindo, texto, decolagem)
    input/              rastreador, teclado, gestos, vetores do braço
    ui/                 HUD e menus
    render/             pós-processamento e riscos de vento
    audio/              sons sintetizados
    styles/main.css
```

## Problemas comuns

- **Braços trocados ou mergulho invertido**: `Ajustes` no menu (Asas / Mergulho).
- **Não calibra**: fique visível da cintura para cima, braços abertos na altura dos ombros, tronco reto, por um instante. `C` recalibra no ar.
- **Travando**: `Ajustes → Qualidade: leve`, feche outros programas. `F3` mostra FPS, estado do rastreador e erros.
- **Rastreador offline**: o jogo funciona no teclado; confira o terminal do Python.

## Créditos

Modelos de pássaros CC-BY 3.0 (via poly.pizza): “Hawk Lp Rigged” por Sherkiz, “Flying seagull” por Poly by Google, “bird” por Kelli Ray. Natureza: Kenney (CC0). Detalhes em [CREDITS.md](CREDITS.md).

# Tetris ESP32 — Pocket Arcade

## Hospedagem na Vercel

O arquivo `vercel.json` configura o site estático sem instalação de dependências nem compilação, publicando a pasta `dist` na raiz do domínio.

Para publicar pela interface da Vercel, importe `CaioOlliveira/game_tetris`, mantenha a raiz do projeto em `./` e clique em Deploy. A configuração de saída já está no repositório. Alternativamente, com a CLI autenticada, execute `vercel --prod` na raiz do projeto. A hospedagem HTTPS permite usar Web Bluetooth em navegadores compatíveis.

## Abrir e jogar

Abra `dist/index.html` diretamente no Chrome ou em outro navegador moderno. Não exige servidor, instalação, ESP32 ou internet. Clique em **COMEÇAR** no display. Os arquivos `index.html`, `style.css` e `script.js` ficam juntos em `dist/`, prontos para copiar para o celular ou hospedar. A interface utiliza fontes locais e não faz requisições externas.

## Controles e regras

| Ação | Teclado | ESP32 |
|---|---|---|
| Mover | ← / → | Esquerda / Direita, uma vez por clique |
| Girar horário | ↑ | Girar |
| Queda acelerada | ↓ | Descer; segure para repetir |
| Queda instantânea | Espaço | Disponível pelo teclado |
| Pausar / continuar | P | Segurar Girar para pausar, clicar para continuar |
| Nova partida | ↑ no fim da partida | Girar no fim da partida |

São sete peças embaralhadas pelo sistema 7-bag (cada conjunto contém todas as sete). A rotação usa os ajustes SRS de parede e piso para I e demais peças; O não muda. A sombra indica onde a peça cairá. Há 500 ms para ajustar uma peça no chão, com até 15 reinicializações desse tempo por peça. Peças fixadas acima do topo ou uma nova peça bloqueada encerram a partida. Ao trocar de janela, a partida local pausa.

Uma, duas, três ou quatro linhas simultâneas valem 100, 300, 500 ou 800 pontos multiplicados pelo nível atual. Descida manual soma 1 por célula; queda instantânea soma 2. A cada 10 linhas o nível aumenta. O intervalo de gravidade começa em 800 ms e é multiplicado por 0,8 por nível, limitado a 65 ms. O primeiro gesto no navegador habilita os efeitos Web Audio da partida local.

## Display

O Canvas tem resolução interna **240 × 320**, ampliada por CSS em proporção 3:4. Isso simula os pixels do TFT; o tamanho físico de 2,4 polegadas depende da densidade e escala da tela do usuário. Tabuleiro 10 × 20, células de 15 pixels, pontuação, nível, linhas e próxima peça cabem no próprio Canvas. O menu inicial fica sobre a área do display. Não há rolagem interna.

## Organização

- `dist/index.html`: interface, menu e controles acessíveis.
- `dist/style.css`: aparência e layout responsivo.
- `dist/script.js`: `TetrisEngine` (regras), `TFTRenderer` (Canvas), `RetroAudio` (Web Audio), `ESP32BLE` (transporte), e integração de entrada/loop.
- `firmware/tetris_esp32/tetris_esp32.ino`: jogo, botões, buzzer e servidor BLE para o ESP32.
- `firmware/README.md`: montagem e gravação do ESP32.
- `tests/engine.test.cjs`: testes executáveis com `node --test tests/engine.test.cjs`.

O loop usa requestAnimationFrame e delta de tempo, limitado a 100 ms para evitar saltos ao retomar uma aba. A lógica local fica suspensa durante a conexão BLE. Controles remotos enviam comandos; somente estados recebidos do firmware atualizam o jogo remoto. Ao desconectar, o menu local reaparece para iniciar uma nova partida independente.

## Firmware ESP32 / contrato BLE v1

O firmware está em [`firmware/tetris_esp32/tetris_esp32.ino`](firmware/tetris_esp32/tetris_esp32.ino). Consulte [`firmware/README.md`](firmware/README.md) para instalar e gravar. Os UUIDs abaixo são específicos deste projeto.

| Item | UUID |
|---|---|
| Serviço anunciado | `702a0001-3a5a-4b2e-9f4c-18c8e6503200` |
| Estado (notify) | `702a0002-3a5a-4b2e-9f4c-18c8e6503200` |
| Comandos (write with response) | `702a0003-3a5a-4b2e-9f4c-18c8e6503200` |

O ESP32 anuncia o serviço BLE; o navegador no celular, notebook ou PC inicia a conexão ao clicar em **CONECTAR ESP32**. Não é preciso parear antes nas configurações Bluetooth do sistema. Web Bluetooth exige navegador/plataforma compatível e origem segura (HTTPS ou localhost). Use Chrome Android ou Chrome desktop com suporte Bluetooth do sistema. A abertura via arquivo local serve ao jogo offline; para BLE utilize HTTPS/localhost. iOS e navegadores sem Web Bluetooth continuam podendo jogar offline.

O ESP32 deve anunciar o UUID de serviço. **CONECTAR ESP32** abre o seletor nativo; após a conexão o site assina notificações e envia `sync`. Cada mensagem é JSON UTF-8 encerrada por LF (`\n`). O firmware deve fragmentar as mensagens de estado conforme o MTU negociado. O navegador junta os fragmentos, aceita mensagens completas e valida dimensões, IDs e limites antes de renderizar. Tamanho máximo do buffer: 16 KiB.

Exemplo do formato de estado (substitua board por uma matriz real de 20 arrays de 10 inteiros):

```js
{
  v: 1,
  board: Array.from({length:20},()=>Array(10).fill(0)),
  active: {id:3, m:[[0,3,0],[3,3,3],[0,0,0]], x:3, y:0},
  next: 1, score: 0, lines: 0, level: 1, status: 'playing', menuSelection: 0
}
```

IDs: 0 vazio, 1 I, 2 O, 3 T, 4 S, 5 Z, 6 J, 7 L. `board` contém apenas blocos fixos. `active` é a peça em movimento (ou null), com matriz quadrada de 2 a 4 células por lado, exatamente quatro blocos do seu ID, e coordenadas relativas ao topo esquerdo do tabuleiro. Y negativo é permitido no nascimento. `status`: `menu`, `help`, `playing`, `paused` ou `over`. No menu, `menuSelection` vale 0 para Começar e 1 para Como jogar. O ESP32 envia estados após cada alteração e responde a `sync` imediatamente com o estado atual.

Comandos do site: `{"v":1,"action":"left"}\n`. Ações: `left`, `right`, `rotate`, `down`, `drop`, `pause` (alternar), `restart`, `help` (abrir o manual no menu) e `sync`. As escritas são serializadas para evitar operações GATT simultâneas. Cada comando é um evento discreto; o site repete a descida ao segurar Descer. GPIO 25 (esquerda), 15 (girar), 27 (direita) e 21 (descida rápida) devem ser lidos e tratados com debounce pelo firmware. GPIO 33 controla o buzzer passivo; os efeitos Web Audio servem como referência, não enviam áudio ao buzzer.

O firmware mantém a lógica oficial, pontuação, gravidade, botões físicos e buzzer. O navegador mostra o estado remoto e oferece controles auxiliares. Com MTU BLE pequeno, o firmware fragmenta o JSON e agrupa atualizações rápidas para manter o estado mais recente. A ligação real com o hardware ainda precisa de teste na bancada.

Depois de conectar, o ESP32 aguarda no menu. Esquerda seleciona Como jogar, Descida rápida volta para Começar e Girar confirma a opção ou fecha o manual. Atualize o firmware para navegar com os botões físicos.

O menu e o manual usam notificações compactas com os campos `v`, `status` e `menuSelection`. Na pausa ou no fim da partida, Esquerda volta ao menu. A tela oferece um único botão abaixo do tabuleiro para pausar ou continuar.

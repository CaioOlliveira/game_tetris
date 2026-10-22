# Firmware Tetris ESP32

Este firmware roda o jogo no **ESP32 DevKit / WROOM-32** e envia o tabuleiro por Bluetooth Low Energy (BLE) ao [site do jogo](https://gametetris-coral.vercel.app/). O navegador do notebook, PC ou celular mostra a partida e pode enviar comandos. Nenhuma tela TFT física é necessária nesta montagem.

## Componentes e ligações

| Componente | ESP32 | Outra ponta |
|---|---|---|
| Botão esquerdo | GPIO 25 | GND |
| Botão girar | GPIO 26 | GND |
| Botão direito | GPIO 27 | GND |
| Buzzer **passivo** | GPIO 33 | GND, com circuito de acionamento adequado ao buzzer |

Os botões usam `INPUT_PULLUP`: ficam em nível alto quando soltos e são acionados ao ligar o pino ao GND. O código trata bounce e repete esquerda/direita ao segurar. Para o buzzer, confira corrente e tensão do seu módulo; se exceder a capacidade do GPIO, use transistor e resistor. Um buzzer ativo não reproduz as notas do PWM corretamente.

## Instalação e gravação

1. Instale a [Arduino IDE](https://www.arduino.cc/en/software) e a plataforma **esp32 by Espressif Systems** na versão **3.3.12** pelo Gerenciador de Placas. A URL da plataforma é `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
2. Instale **NimBLE-Arduino**, versão **2.5.1**, pelo Gerenciador de Bibliotecas.
3. Abra [`tetris_esp32/tetris_esp32.ino`](tetris_esp32/tetris_esp32.ino) na Arduino IDE. Selecione **ESP32 Dev Module** e a porta USB do ESP32.
4. Clique em **Upload**. Abra o Monitor Serial em **115200 baud**. O aviso `Tetris ESP32 advertising BLE service` indica que o serviço está anunciado.
5. Ative o Bluetooth do computador ou celular. Em um navegador com Web Bluetooth, abra `https://gametetris-coral.vercel.app/`, clique em **CONECTAR ESP32** e escolha **Tetris ESP32**. A conexão parte do navegador; não faça pareamento manual nas configurações do sistema.

### Se a porta do ESP32 não aparecer no Windows

Abra o **Gerenciador de Dispositivos**. Se aparecer **CP2102 USB to UART Bridge Controller** com erro **28**, falta o driver da porta serial. Baixe o **CP210x Universal Windows Driver** na [página oficial da Silicon Labs](https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers), extraia o ZIP e instale `silabser.inf` com uma conta de administrador. No Windows 11, talvez seja necessário usar **Mostrar mais opções** para ver **Instalar**; também é possível escolher **Atualizar driver** no Gerenciador de Dispositivos e apontar para a pasta extraída. Depois, desconecte e reconecte a placa e selecione a nova porta **COM** em **Ferramentas > Porta** na Arduino IDE. A **COM1** interna do PC não é a porta do ESP32.

Para compilar por linha de comando, com Arduino CLI, plataforma e biblioteca instaladas:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/tetris_esp32
```

## Compatibilidade e funcionamento

O ESP32 anuncia o serviço `702a0001-3a5a-4b2e-9f4c-18c8e6503200`. O site descobre esse serviço, assina notificações do estado e envia `sync`. O ESP32 responde com um JSON terminado em `\n` e continua enviando o estado quando o jogo muda. Mensagens maiores que o MTU negociado são divididas entre notificações, que o site reúne antes de interpretar. Os comandos do site incluem mover, girar, descer, queda instantânea, pausar e reiniciar. O jogo usa as mesmas peças, rotação SRS, pontuação, gravidade e tempo de fixação do modo local.

O site requer **HTTPS** e um navegador com Web Bluetooth, como Chrome no Android ou em desktop com suporte Bluetooth. O modo local do site continua disponível nos demais navegadores. O firmware foi preparado para um navegador conectado por vez. Se você usar outra variante de ESP32, confira se ela tem BLE e adapte os quatro GPIOs no início do arquivo `.ino`.

O projeto foi compilado para ESP32 Dev Module, mas a conexão BLE e os componentes físicos precisam ser conferidos no seu hardware.

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <esp_arduino_version.h>
#include <math.h>
#include <stdarg.h>
#include <string.h>

// ESP32 DevKit / WROOM-32. Buttons connect each GPIO to GND.
constexpr uint8_t PIN_LEFT = 25;
constexpr uint8_t PIN_ROTATE = 26;
constexpr uint8_t PIN_RIGHT = 27;
constexpr uint8_t PIN_BUZZER = 33; // Passive buzzer, via a suitable driver if needed.

constexpr char SERVICE_UUID[] = "702a0001-3a5a-4b2e-9f4c-18c8e6503200";
constexpr char STATE_UUID[] = "702a0002-3a5a-4b2e-9f4c-18c8e6503200";
constexpr char COMMAND_UUID[] = "702a0003-3a5a-4b2e-9f4c-18c8e6503200";

constexpr uint8_t BOARD_W = 10;
constexpr uint8_t BOARD_H = 20;
constexpr uint16_t LOCK_DELAY_MS = 500;
constexpr uint8_t MAX_LOCK_RESETS = 15;
constexpr uint16_t MIN_NOTIFY_INTERVAL_MS = 90;

enum Action : uint8_t { SYNC, LEFT, RIGHT, ROTATE, DOWN, DROP, PAUSE, RESTART, CONNECT, DISCONNECT, SUBSCRIBE };
enum GameStatus : uint8_t { PLAYING, PAUSED, OVER };
enum Sound : uint8_t { SILENT, START_SOUND, MOVE_SOUND, ROTATE_SOUND, LOCK_SOUND, CLEAR_SOUND, OVER_SOUND };

struct Event { Action action; uint16_t handle; bool enabled; };
QueueHandle_t eventQueue = nullptr;
NimBLEServer* bleServer = nullptr;
NimBLECharacteristic* stateCharacteristic = nullptr;
bool connected = false;
bool subscribed = false;
uint16_t connectionHandle = 0;
bool stateDirty = true;
bool forceState = false;
bool needsResync = false;
uint32_t lastSendMs = 0;

// IDs: 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L.
const uint8_t initialShapes[8][4][4] = {
  {{0}},
  {{0,0,0,0},{1,1,1,1},{0,0,0,0},{0,0,0,0}},
  {{2,2},{2,2}},
  {{0,3,0},{3,3,3},{0,0,0}},
  {{0,4,4},{4,4,0},{0,0,0}},
  {{5,5,0},{0,5,5},{0,0,0}},
  {{6,0,0},{6,6,6},{0,0,0}},
  {{0,0,7},{7,7,7},{0,0,0}}
};
const uint8_t shapeSize[8] = {0,4,2,3,3,3,3,3};

// Clockwise SRS kicks in screen coordinates (Y grows downwards).
const int8_t kicks[4][5][2] = {
  {{0,0},{-1,0},{-1,-1},{0,2},{-1,2}},
  {{0,0},{1,0},{1,1},{0,-2},{1,-2}},
  {{0,0},{1,0},{1,-1},{0,2},{1,2}},
  {{0,0},{-1,0},{-1,1},{0,-2},{-1,-2}}
};
const int8_t iKicks[4][5][2] = {
  {{0,0},{-2,0},{1,0},{-2,1},{1,-2}},
  {{0,0},{-1,0},{2,0},{-1,-2},{2,1}},
  {{0,0},{2,0},{-1,0},{2,-1},{-1,2}},
  {{0,0},{1,0},{-2,0},{1,2},{-2,-1}}
};

struct Piece {
  uint8_t id = 0;
  uint8_t size = 0;
  uint8_t cells[4][4] = {{0}};
  int8_t x = 0;
  int8_t y = 0;
  uint8_t rotation = 0;
};

class TetrisGame {
public:
  uint8_t board[BOARD_H][BOARD_W] = {{0}};
  Piece active;
  uint8_t next = 1;
  uint32_t score = 0;
  uint32_t lines = 0;
  uint32_t level = 1;
  GameStatus status = PLAYING;
  Sound sound = SILENT;

  void start() {
    memset(board, 0, sizeof(board));
    score = lines = 0;
    level = 1;
    bagRemaining = 0;
    next = take();
    status = PLAYING;
    fallMs = lockMs = 0;
    lockResets = 0;
    spawn();
    sound = START_SOUND;
  }

  bool move(int8_t dx) {
    if (status != PLAYING) return false;
    bool wasGrounded = grounded();
    if (collides(active.cells, active.size, active.x + dx, active.y)) return false;
    active.x += dx;
    resetLock(wasGrounded);
    sound = MOVE_SOUND;
    return true;
  }

  bool rotate() {
    if (status != PLAYING || active.id == 2) return false;
    uint8_t rotated[4][4] = {{0}};
    for (uint8_t y = 0; y < active.size; ++y)
      for (uint8_t x = 0; x < active.size; ++x)
        rotated[x][active.size - 1 - y] = active.cells[y][x];

    bool wasGrounded = grounded();
    const int8_t (*table)[2] = active.id == 1 ? iKicks[active.rotation] : kicks[active.rotation];
    for (uint8_t i = 0; i < 5; ++i) {
      int8_t x = active.x + table[i][0], y = active.y + table[i][1];
      if (collides(rotated, active.size, x, y)) continue;
      memcpy(active.cells, rotated, sizeof(rotated));
      active.x = x;
      active.y = y;
      active.rotation = (active.rotation + 1) & 3;
      resetLock(wasGrounded);
      sound = ROTATE_SOUND;
      return true;
    }
    return false;
  }

  bool down(bool manual) {
    if (status != PLAYING || collides(active.cells, active.size, active.x, active.y + 1)) return false;
    ++active.y;
    if (manual) ++score;
    return true;
  }

  bool hardDrop() {
    if (status != PLAYING) return false;
    while (down(false)) score += 2;
    fix();
    return true;
  }

  bool pause() {
    if (status == PLAYING) status = PAUSED;
    else if (status == PAUSED) status = PLAYING;
    else return false;
    return true;
  }

  bool tick(uint32_t elapsedMs) {
    if (status != PLAYING) return false;
    if (elapsedMs > 100) elapsedMs = 100; // Same resume bound as the web engine.
    bool changed = false;
    fallMs += elapsedMs;
    double interval = 800.0;
    for (uint32_t n = 1; n < level && interval > 65.0; ++n) interval *= 0.8;
    if (interval < 65.0) interval = 65.0;
    while (fallMs >= interval) {
      fallMs -= interval;
      if (down(false)) changed = true;
      else { fallMs = 0; break; }
    }
    if (grounded()) {
      lockMs += elapsedMs;
      if (lockMs >= LOCK_DELAY_MS) { fix(); changed = true; }
    } else lockMs = 0;
    return changed;
  }

private:
  uint8_t bag[7] = {0};
  uint8_t bagRemaining = 0;
  double fallMs = 0;
  uint32_t lockMs = 0;
  uint8_t lockResets = 0;

  uint8_t take() {
    if (!bagRemaining) {
      for (uint8_t i = 0; i < 7; ++i) bag[i] = i + 1;
      for (uint8_t i = 6; i > 0; --i) {
        uint8_t j = random(i + 1);
        uint8_t tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
      bagRemaining = 7;
    }
    return bag[--bagRemaining];
  }

  bool collides(const uint8_t cells[4][4], uint8_t size, int8_t x, int8_t y) const {
    for (uint8_t row = 0; row < size; ++row) for (uint8_t col = 0; col < size; ++col) {
      if (!cells[row][col]) continue;
      int16_t bx = x + col, by = y + row;
      if (bx < 0 || bx >= BOARD_W || by >= BOARD_H || (by >= 0 && board[by][bx])) return true;
    }
    return false;
  }

  bool grounded() const { return collides(active.cells, active.size, active.x, active.y + 1); }
  void resetLock(bool wasGrounded) {
    if (wasGrounded && lockResets < MAX_LOCK_RESETS) { lockMs = 0; ++lockResets; }
  }

  void spawn() {
    active.id = next;
    next = take();
    active.size = shapeSize[active.id];
    memcpy(active.cells, initialShapes[active.id], sizeof(active.cells));
    active.x = active.id == 2 ? 4 : 3;
    active.y = -1;
    active.rotation = 0;
    lockMs = fallMs = 0;
    lockResets = 0;
    if (collides(active.cells, active.size, active.x, active.y)) end();
  }

  void fix() {
    bool above = false;
    for (uint8_t row = 0; row < active.size; ++row) for (uint8_t col = 0; col < active.size; ++col) {
      uint8_t value = active.cells[row][col];
      if (!value) continue;
      int16_t y = active.y + row;
      if (y < 0) above = true;
      else board[y][active.x + col] = value;
    }
    if (above) { end(); return; }

    int8_t destination = BOARD_H - 1;
    for (int8_t row = BOARD_H - 1; row >= 0; --row) {
      bool full = true;
      for (uint8_t col = 0; col < BOARD_W; ++col) if (!board[row][col]) { full = false; break; }
      if (!full) { if (destination != row) memcpy(board[destination], board[row], BOARD_W); --destination; }
    }
    uint8_t cleared = destination + 1;
    for (int8_t row = destination; row >= 0; --row) memset(board[row], 0, BOARD_W);
    const uint16_t points[5] = {0, 100, 300, 500, 800};
    score += uint32_t(points[cleared]) * level;
    lines += cleared;
    level = 1 + lines / 10;
    sound = cleared ? CLEAR_SOUND : LOCK_SOUND;
    spawn();
  }

  void end() { status = OVER; sound = OVER_SOUND; }
};

TetrisGame game;

struct Button {
  uint8_t pin;
  Action action;
  bool raw = HIGH;
  bool stable = HIGH;
  uint32_t changedAt = 0;
  uint32_t nextRepeat = 0;
};
Button buttons[] = {{PIN_LEFT, LEFT}, {PIN_ROTATE, ROTATE}, {PIN_RIGHT, RIGHT}};

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    if (server->getConnectedCount() > 1) { server->disconnect(info.getConnHandle()); return; }
    Event event{CONNECT, info.getConnHandle(), false};
    xQueueSend(eventQueue, &event, 0);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo& info, int) override {
    Event event{DISCONNECT, info.getConnHandle(), false};
    xQueueSend(eventQueue, &event, 0);
  }
} serverCallbacks;

class StateCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo& info, uint16_t value) override {
    Event event{SUBSCRIBE, info.getConnHandle(), bool(value & 1)};
    xQueueSend(eventQueue, &event, 0);
  }
} stateCallbacks;

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& info) override {
    std::string value = characteristic->getValue();
    if (value.size() > 64 || value.empty() || value.back() != '\n') return;
    value.pop_back();
    // The site's JSON.stringify output is canonical and newline terminated.
    static const struct { const char* text; Action action; } commands[] = {
      {"{\"v\":1,\"action\":\"sync\"}", SYNC},
      {"{\"v\":1,\"action\":\"left\"}", LEFT},
      {"{\"v\":1,\"action\":\"right\"}", RIGHT},
      {"{\"v\":1,\"action\":\"rotate\"}", ROTATE},
      {"{\"v\":1,\"action\":\"down\"}", DOWN},
      {"{\"v\":1,\"action\":\"drop\"}", DROP},
      {"{\"v\":1,\"action\":\"pause\"}", PAUSE},
      {"{\"v\":1,\"action\":\"restart\"}", RESTART}
    };
    for (const auto& command : commands) if (value == command.text) {
      Event event{command.action, info.getConnHandle(), false};
      xQueueSend(eventQueue, &event, 0);
      return;
    }
  }
} commandCallbacks;

bool append(char* buffer, size_t capacity, size_t& length, const char* format, ...) {
  if (length >= capacity) return false;
  va_list args;
  va_start(args, format);
  int written = vsnprintf(buffer + length, capacity - length, format, args);
  va_end(args);
  if (written < 0 || size_t(written) >= capacity - length) return false;
  length += written;
  return true;
}

size_t buildState(char* output, size_t capacity) {
  size_t length = 0;
  if (!append(output, capacity, length, "{\"v\":1,\"board\":[")) return 0;
  for (uint8_t row = 0; row < BOARD_H; ++row) {
    if (!append(output, capacity, length, "%s[", row ? "," : "")) return 0;
    for (uint8_t col = 0; col < BOARD_W; ++col)
      if (!append(output, capacity, length, "%s%u", col ? "," : "", game.board[row][col])) return 0;
    if (!append(output, capacity, length, "]")) return 0;
  }
  if (!append(output, capacity, length, "],\"active\":{\"id\":%u,\"m\":[", game.active.id)) return 0;
  for (uint8_t row = 0; row < game.active.size; ++row) {
    if (!append(output, capacity, length, "%s[", row ? "," : "")) return 0;
    for (uint8_t col = 0; col < game.active.size; ++col)
      if (!append(output, capacity, length, "%s%u", col ? "," : "", game.active.cells[row][col])) return 0;
    if (!append(output, capacity, length, "]")) return 0;
  }
  const char* status = game.status == PLAYING ? "playing" : game.status == PAUSED ? "paused" : "over";
  if (!append(output, capacity, length,
      "],\"x\":%d,\"y\":%d},\"next\":%u,\"score\":%lu,\"lines\":%lu,\"level\":%lu,\"status\":\"%s\"}\n",
      game.active.x, game.active.y, game.next,
      (unsigned long)game.score, (unsigned long)game.lines, (unsigned long)game.level, status)) return 0;
  return length;
}

void sendState(uint32_t now) {
  if (!connected || !subscribed || !stateDirty || (!forceState && now - lastSendMs < MIN_NOTIFY_INTERVAL_MS)) return;
  char payload[768];
  size_t length = buildState(payload, sizeof(payload));
  if (!length) { Serial.println("State buffer too small"); return; }
  uint16_t mtu = bleServer->getPeerMTU(connectionHandle);
  if (mtu < 23) mtu = 23;
  size_t chunkSize = mtu - 3 < 180 ? mtu - 3 : 180;
  if (needsResync) {
    const uint8_t newline = '\n';
    if (!stateCharacteristic->notify(&newline, 1, connectionHandle)) return;
    needsResync = false;
    delay(3);
  }
  for (size_t offset = 0; offset < length; offset += chunkSize) {
    size_t count = chunkSize < length - offset ? chunkSize : length - offset;
    if (!stateCharacteristic->notify((const uint8_t*)payload + offset, count, connectionHandle)) {
      needsResync = true;
      lastSendMs = millis();
      return;
    }
    delay(3);
  }
  stateDirty = false;
  forceState = false;
  lastSendMs = millis();
}

void startTone(uint16_t frequency) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(PIN_BUZZER, frequency);
#else
  ledcWriteTone(0, frequency);
#endif
}

void setupBuzzer() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_BUZZER, 1000, 8);
#else
  ledcSetup(0, 1000, 8);
  ledcAttachPin(PIN_BUZZER, 0);
#endif
  startTone(0);
}

void updateSound(uint32_t now) {
  static uint32_t stopAt = 0;
  if (game.sound != SILENT) {
    uint16_t frequency = 0;
    switch (game.sound) {
      case START_SOUND: frequency = 440; break;
      case MOVE_SOUND: frequency = 180; break;
      case ROTATE_SOUND: frequency = 350; break;
      case LOCK_SOUND: frequency = 110; break;
      case CLEAR_SOUND: frequency = 660; break;
      case OVER_SOUND: frequency = 196; break;
      default: break;
    }
    startTone(frequency);
    stopAt = now + (game.sound == CLEAR_SOUND ? 120 : 65);
    game.sound = SILENT;
  } else if (stopAt && int32_t(now - stopAt) >= 0) {
    startTone(0);
    stopAt = 0;
  }
}

void applyAction(Action action) {
  bool changed = false;
  switch (action) {
    case SYNC: forceState = true; changed = true; break;
    case LEFT: changed = game.move(-1); break;
    case RIGHT: changed = game.move(1); break;
    case ROTATE: changed = game.rotate(); break;
    case DOWN: changed = game.down(true); break;
    case DROP: changed = game.hardDrop(); break;
    case PAUSE: changed = game.pause(); break;
    case RESTART: game.start(); changed = true; break;
    default: break;
  }
  if (changed) stateDirty = true;
}

void pollButtons(uint32_t now) {
  for (Button& button : buttons) {
    bool reading = digitalRead(button.pin);
    if (reading != button.raw) { button.raw = reading; button.changedAt = now; }
    if (reading != button.stable && now - button.changedAt >= 25) {
      button.stable = reading;
      if (reading == LOW) {
        applyAction(button.action);
        button.nextRepeat = now + 160;
      }
    }
    if (button.stable == LOW && button.action != ROTATE && int32_t(now - button.nextRepeat) >= 0) {
      applyAction(button.action);
      button.nextRepeat = now + 65;
    }
  }
}

void setup() {
  Serial.begin(115200);
  randomSeed(esp_random());
  for (Button& button : buttons) pinMode(button.pin, INPUT_PULLUP);
  setupBuzzer();
  game.start();
  eventQueue = xQueueCreate(24, sizeof(Event));
  if (!eventQueue) { Serial.println("BLE queue allocation failed"); while (true) delay(1000); }

  NimBLEDevice::init("Tetris ESP32");
  NimBLEDevice::setMTU(517);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(&serverCallbacks);
  bleServer->advertiseOnDisconnect(true);
  NimBLEService* service = bleServer->createService(SERVICE_UUID);
  stateCharacteristic = service->createCharacteristic(STATE_UUID, NIMBLE_PROPERTY::NOTIFY);
  stateCharacteristic->setCallbacks(&stateCallbacks);
  NimBLECharacteristic* command = service->createCharacteristic(COMMAND_UUID, NIMBLE_PROPERTY::WRITE);
  command->setCallbacks(&commandCallbacks);
  bleServer->start();
  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setName("Tetris ESP32");
  advertising->enableScanResponse(true);
  advertising->start();
  Serial.println("Tetris ESP32 advertising BLE service; open the site and tap CONECTAR ESP32.");
}

void loop() {
  static uint32_t previousMs = millis();
  uint32_t now = millis();
  uint32_t elapsed = now - previousMs;
  previousMs = now;

  Event event;
  for (uint8_t count = 0; count < 24 && xQueueReceive(eventQueue, &event, 0) == pdTRUE; ++count) {
    if (event.action == CONNECT) {
      connected = true;
      subscribed = false;
      connectionHandle = event.handle;
      stateDirty = true;
      needsResync = false;
      Serial.println("Browser connected");
    } else if (event.action == DISCONNECT && event.handle == connectionHandle) {
      connected = subscribed = false;
      Serial.println("Browser disconnected; advertising again");
    } else if (event.action == SUBSCRIBE && event.handle == connectionHandle) {
      subscribed = event.enabled;
      if (subscribed) { stateDirty = true; forceState = true; }
    } else if (connected && event.handle == connectionHandle) applyAction(event.action);
  }

  pollButtons(now);
  if (game.tick(elapsed)) stateDirty = true;
  updateSound(now);
  sendState(now);
  delay(1);
}

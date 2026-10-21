import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";

/* ============================================================
   Dados e regras do timer
   ============================================================ */
const STORAGE_KEY = "intervalo:v1";

const uid = () => "p" + Math.random().toString(36).slice(2, 9);

const defaultPresets = () => [
  { id: uid(), name: "Tabata", warmup: 10, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 0, cooldown: 0 },
  { id: uid(), name: "HIIT 40/20", warmup: 15, work: 40, rest: 20, rounds: 10, sets: 1, setRest: 0, cooldown: 30 },
  { id: uid(), name: "Boxe – 3 rounds", warmup: 10, work: 180, rest: 60, rounds: 3, sets: 1, setRest: 0, cooldown: 0 },
  { id: uid(), name: "Descanso da musculação", warmup: 0, work: 5, rest: 90, rounds: 4, sets: 1, setRest: 0, cooldown: 0 },
  { id: uid(), name: "Circuito 3 séries", warmup: 10, work: 45, rest: 15, rounds: 6, sets: 3, setRest: 60, cooldown: 30 },
];

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
};

function buildSegments(p) {
  const segs = [];
  if (p.warmup > 0) segs.push({ phase: "warmup", dur: p.warmup, round: 0, set: 0 });
  for (let s = 1; s <= p.sets; s++) {
    for (let r = 1; r <= p.rounds; r++) {
      segs.push({ phase: "work", dur: p.work, round: r, set: s });
      const last = s === p.sets && r === p.rounds;
      if (last) continue;
      if (r === p.rounds) {
        if (p.setRest > 0) segs.push({ phase: "setrest", dur: p.setRest, round: r, set: s });
        else if (p.rest > 0) segs.push({ phase: "rest", dur: p.rest, round: r, set: s });
      } else if (p.rest > 0) {
        segs.push({ phase: "rest", dur: p.rest, round: r, set: s });
      }
    }
  }
  if (p.cooldown > 0) segs.push({ phase: "cooldown", dur: p.cooldown, round: 0, set: 0 });
  return segs;
}

const totalOf = (p) => buildSegments(p).reduce((a, s) => a + s.dur, 0);

const PHASE_LABEL = {
  warmup: "Preparar",
  work: "Trabalhar",
  rest: "Descansar",
  setrest: "Descanso da série",
  cooldown: "Desaquecer",
  done: "Treino concluído",
};

const PHASE_COLORS = {
  warmup: { bg: "#FFB400", fg: "#1A1200" },
  work: { bg: "#2F4BFF", fg: "#FFFFFF" },
  rest: { bg: "#3DDBB0", fg: "#062B22" },
  setrest: { bg: "#B9A6FF", fg: "#1B1240" },
  cooldown: { bg: "#7A5CFF", fg: "#FFFFFF" },
  done: { bg: "#1B1F27", fg: "#FFFFFF" },
};

/* ============================================================
   Áudio, voz e vibração
   ============================================================ */
const SOUND_SOURCES = {
  tick: require("./assets/sounds/tick.wav"),
  start: require("./assets/sounds/start.wav"),
  rest: require("./assets/sounds/rest.wav"),
  end: require("./assets/sounds/end.wav"),
  silence: require("./assets/sounds/silence.wav"),
};

let players = null;
function getPlayers() {
  if (!players) {
    players = {};
    Object.keys(SOUND_SOURCES).forEach((k) => {
      players[k] = createAudioPlayer(SOUND_SOURCES[k]);
    });
    players.silence.loop = true;
    players.silence.volume = 0;
  }
  return players;
}

async function configureAudio() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "mixWithOthers",
    });
  } catch (e) {}
}

function playSound(name, enabled) {
  if (!enabled) return;
  try {
    const p = getPlayers()[name];
    p.seekTo(0);
    p.play();
  } catch (e) {}
}

// Um áudio mudo em loop mantém o app ativo com a tela bloqueada.
function startKeepAlive() {
  try {
    const p = getPlayers().silence;
    p.play();
    p.setActiveForLockScreen(true, { title: "Treino em andamento", artist: "Intervalo" });
  } catch (e) {}
}
function stopKeepAlive() {
  try {
    const p = getPlayers().silence;
    p.pause();
    p.clearLockScreenControls();
  } catch (e) {}
}

function speak(text, enabled) {
  if (!enabled) return;
  try {
    Speech.stop();
    Speech.speak(text, { language: "pt-BR", rate: 1.05 });
  } catch (e) {}
}

function vibrate(kind, enabled) {
  if (!enabled) return;
  try {
    if (kind === "tick") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === "start") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "end") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch (e) {}
}

/* ============================================================
   Tema
   ============================================================ */
function useTheme(pref) {
  const system = useColorScheme();
  const mode = pref === "light" || pref === "dark" ? pref : system === "dark" ? "dark" : "light";
  return useMemo(
    () =>
      mode === "dark"
        ? { mode, bg: "#0E1117", surface: "#181D26", ink: "#F1F4F9", muted: "#9AA5B5", line: "#2A313D", accent: "#6B80FF", accentInk: "#0E1117", danger: "#FF7A85" }
        : { mode, bg: "#EEF1F5", surface: "#FFFFFF", ink: "#12161D", muted: "#5B6574", line: "#D9DFE7", accent: "#2F4BFF", accentInk: "#FFFFFF", danger: "#C62F3D" },
    [mode]
  );
}

/* ============================================================
   App
   ============================================================ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [presets, setPresets] = useState([]);
  const [settings, setSettings] = useState({ sound: true, voice: true, vibrate: true, theme: "auto" });
  const [screen, setScreen] = useState({ name: "home" });
  const theme = useTheme(settings.theme);

  useEffect(() => {
    configureAudio();
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const d = raw ? JSON.parse(raw) : null;
        if (d && Array.isArray(d.presets) && d.presets.length) {
          setPresets(d.presets);
          setSettings((s) => ({ ...s, ...(d.settings || {}) }));
        } else {
          setPresets(defaultPresets());
        }
      } catch (e) {
        setPresets(defaultPresets());
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ presets, settings })).catch(() => {});
  }, [presets, settings, ready]);

  // Botão voltar do Android
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const n = screenRef.current.name;
      if (n === "edit" || n === "settings") {
        setScreen({ name: "home" });
        return true;
      }
      return n === "run"; // a tela de treino cuida do próprio "voltar"
    });
    return () => sub.remove();
  }, []);

  const savePreset = (p) => {
    setPresets((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]));
    setScreen({ name: "home" });
  };
  const deletePreset = (id) => {
    setPresets((list) => list.filter((x) => x.id !== id));
    setScreen({ name: "home" });
  };

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <SafeAreaProvider>
      <StatusBar style={screen.name === "run" ? "light" : theme.mode === "dark" ? "light" : "dark"} />
      {screen.name === "home" && (
        <Home
          theme={theme}
          presets={presets}
          onStart={(p) => setScreen({ name: "run", preset: p })}
          onEdit={(p) => setScreen({ name: "edit", preset: p })}
          onNew={() => setScreen({ name: "edit", preset: null })}
          onSettings={() => setScreen({ name: "settings" })}
        />
      )}
      {screen.name === "edit" && (
        <Editor
          theme={theme}
          preset={screen.preset}
          onSave={savePreset}
          onDelete={deletePreset}
          onCancel={() => setScreen({ name: "home" })}
        />
      )}
      {screen.name === "settings" && (
        <Settings theme={theme} settings={settings} setSettings={setSettings} onClose={() => setScreen({ name: "home" })} />
      )}
      {screen.name === "run" && (
        <Run preset={screen.preset} settings={settings} onClose={() => setScreen({ name: "home" })} />
      )}
    </SafeAreaProvider>
  );
}

/* ============================================================
   Home
   ============================================================ */
function Home({ theme, presets, onStart, onEdit, onNew, onSettings }) {
  const s = useMemo(() => styles(theme), [theme]);
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <View style={s.topRow}>
        <Text style={s.h1}>Intervalo</Text>
        <Pressable style={s.iconBtn} onPress={onSettings} accessibilityLabel="Ajustes">
          <Text style={{ fontSize: 20, color: theme.ink }}>⚙</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}>
        {presets.length === 0 && (
          <Text style={s.empty}>Nenhum timer ainda. Toque em “Novo timer” para criar o primeiro.</Text>
        )}
        {presets.map((p) => {
          const parts = [`${p.rounds} ${p.rounds === 1 ? "rodada" : "rodadas"}`];
          if (p.sets > 1) parts.push(`${p.sets} séries`);
          parts.push(`${fmt(p.work)} trabalho`);
          if (p.rest > 0) parts.push(`${fmt(p.rest)} descanso`);
          return (
            <View key={p.id} style={s.card}>
              <Pressable style={s.cardMain} onPress={() => onEdit(p)}>
                <Text style={s.cardName} numberOfLines={1}>{p.name || "Sem nome"}</Text>
                <Text style={s.cardMeta}>{parts.join(" · ")}</Text>
                <Text style={s.cardTotal}>{fmt(totalOf(p))}</Text>
              </Pressable>
              <Pressable style={s.cardEdit} onPress={() => onEdit(p)} accessibilityLabel="Editar">
                <Text style={{ color: theme.muted, fontSize: 18 }}>✎</Text>
              </Pressable>
              <Pressable style={s.cardGo} onPress={() => onStart(p)} accessibilityLabel="Iniciar">
                <Text style={{ color: theme.accentInk, fontSize: 26 }}>▶</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <SafeAreaView edges={["bottom"]} style={s.fabWrap} pointerEvents="box-none">
        <Pressable style={s.fab} onPress={onNew}>
          <Text style={s.fabText}>+ Novo timer</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

/* ============================================================
   Editor
   ============================================================ */
const FIELDS = [
  { k: "warmup", lab: "Preparação", sub: "Antes de começar", step: 5, min: 0, max: 3600, time: true },
  { k: "work", lab: "Trabalho", sub: "Tempo de esforço", step: 5, min: 1, max: 3600, time: true },
  { k: "rest", lab: "Descanso", sub: "Entre as rodadas", step: 5, min: 0, max: 3600, time: true },
  { k: "rounds", lab: "Rodadas", sub: "Repetições por série", step: 1, min: 1, max: 99 },
  { k: "sets", lab: "Séries", sub: "Quantas vezes repetir tudo", step: 1, min: 1, max: 99 },
  { k: "setRest", lab: "Descanso entre séries", sub: "Só vale com 2 ou mais séries", step: 5, min: 0, max: 3600, time: true },
  { k: "cooldown", lab: "Desaquecimento", sub: "No fim do treino", step: 5, min: 0, max: 3600, time: true },
];

function StepButton({ label, onStep, s }) {
  const t1 = useRef(null);
  const t2 = useRef(null);
  const stop = () => {
    clearTimeout(t1.current);
    clearInterval(t2.current);
  };
  useEffect(() => stop, []);
  return (
    <Pressable
      style={s.stepBtn}
      onPressIn={() => {
        onStep();
        stop();
        t1.current = setTimeout(() => {
          t2.current = setInterval(onStep, 80);
        }, 420);
      }}
      onPressOut={stop}
      accessibilityLabel={label === "+" ? "Aumentar" : "Diminuir"}
    >
      <Text style={s.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

function Editor({ theme, preset, onSave, onDelete, onCancel }) {
  const s = useMemo(() => styles(theme), [theme]);
  const isNew = !preset;
  const [cur, setCur] = useState(
    preset ? { ...preset } : { id: uid(), name: "", warmup: 10, work: 30, rest: 15, rounds: 8, sets: 1, setRest: 0, cooldown: 0 }
  );
  const bump = useCallback((f, d) => {
    setCur((c) => ({ ...c, [f.k]: Math.min(f.max, Math.max(f.min, c[f.k] + d * f.step)) }));
  }, []);

  const confirmDelete = () =>
    Alert.alert("Excluir timer", `Excluir “${cur.name || "este timer"}”?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => onDelete(cur.id) },
    ]);

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={s.h2}>{isNew ? "Novo timer" : "Editar timer"}</Text>
        <View style={s.field}>
          <TextInput
            style={s.nameInput}
            value={cur.name}
            onChangeText={(t) => setCur((c) => ({ ...c, name: t }))}
            placeholder="Nome do treino"
            placeholderTextColor={theme.muted}
            maxLength={40}
          />
        </View>
        <View style={s.field}>
          {FIELDS.map((f, i) => (
            <View key={f.k} style={[s.row, i === 0 && { borderTopWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLab}>{f.lab}</Text>
                <Text style={s.rowSub}>{f.sub}</Text>
              </View>
              <View style={s.stepper}>
                <StepButton s={s} label="−" onStep={() => bump(f, -1)} />
                <Text style={s.stepVal}>{f.time ? fmt(cur[f.k]) : cur[f.k]}</Text>
                <StepButton s={s} label="+" onStep={() => bump(f, 1)} />
              </View>
            </View>
          ))}
        </View>
        <View style={s.summary}>
          <Text style={{ color: theme.muted, fontSize: 17 }}>Duração total</Text>
          <Text style={s.summaryVal}>{fmt(totalOf(cur))}</Text>
        </View>
      </ScrollView>
      <View style={s.bar}>
        {!isNew && (
          <Pressable style={[s.barBtn, { flex: 1 }]} onPress={confirmDelete}>
            <Text style={[s.barText, { color: theme.danger }]}>Excluir</Text>
          </Pressable>
        )}
        <Pressable style={[s.barBtn, { flex: 1 }]} onPress={onCancel}>
          <Text style={s.barText}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={[s.barBtn, { flex: 2, backgroundColor: theme.accent, borderColor: "transparent" }]}
          onPress={() => onSave({ ...cur, name: cur.name.trim() || "Meu treino" })}
        >
          <Text style={[s.barText, { color: theme.accentInk }]}>Salvar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ============================================================
   Ajustes
   ============================================================ */
function Settings({ theme, settings, setSettings, onClose }) {
  const s = useMemo(() => styles(theme), [theme]);
  const toggles = [
    ["sound", "Bipes"],
    ["voice", "Voz (anuncia as fases)"],
    ["vibrate", "Vibração"],
  ];
  const themeNames = { auto: "automático", light: "claro", dark: "escuro" };
  const nextTheme = () => {
    const order = ["auto", "light", "dark"];
    setSettings((st) => ({ ...st, theme: order[(order.indexOf(st.theme || "auto") + 1) % 3] }));
  };
  const test = () => {
    playSound("start", settings.sound);
    speak("Pronto. Vai!", settings.voice);
    vibrate("start", settings.vibrate);
  };
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.h2}>Ajustes</Text>
        <View style={s.field}>
          {toggles.map(([k, label], i) => (
            <View key={k} style={[s.row, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={[s.rowLab, { flex: 1 }]}>{label}</Text>
              <Switch
                value={!!settings[k]}
                onValueChange={(v) => setSettings((st) => ({ ...st, [k]: v }))}
                trackColor={{ true: theme.accent, false: theme.line }}
              />
            </View>
          ))}
        </View>
        <Pressable style={s.linkBtn} onPress={test}>
          <Text style={s.barText}>Testar som, voz e vibração</Text>
        </Pressable>
        <Pressable style={s.linkBtn} onPress={nextTheme}>
          <Text style={s.barText}>Tema: {themeNames[settings.theme || "auto"]}</Text>
        </Pressable>
        <Text style={s.note}>
          Durante o treino a tela fica ligada. Se você bloquear a tela, o app tenta continuar tocando os bipes e a voz em segundo plano.
        </Text>
      </ScrollView>
      <View style={s.bar}>
        <Pressable style={[s.barBtn, { flex: 1, backgroundColor: theme.accent, borderColor: "transparent" }]} onPress={onClose}>
          <Text style={[s.barText, { color: theme.accentInk }]}>Fechar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ============================================================
   Treino em andamento
   ============================================================ */
function Run({ preset, settings, onClose }) {
  useKeepAwake();
  const segs = useMemo(() => buildSegments(preset), [preset]);
  const starts = useMemo(() => {
    let acc = 0;
    return segs.map((sg) => {
      const st = acc;
      acc += sg.dur;
      return st;
    });
  }, [segs]);
  const total = useMemo(() => segs.reduce((a, sg) => a + sg.dur, 0), [segs]);

  // Estado de exibição
  const [view, setView] = useState({ i: 0, remMs: segs[0].dur * 1000, paused: false, finished: false });

  // Estado do motor (não precisa re-renderizar)
  const eng = useRef({ i: 0, endAt: 0, remMs: 0, paused: false, finished: false, lastSec: null, timer: null });
  const cfg = useRef(settings);
  cfg.current = settings;

  const announce = (index) => {
    const sg = segs[index];
    const c = cfg.current;
    if (sg.phase === "work") {
      const lastRound = sg.round === preset.rounds && sg.set === preset.sets;
      playSound("start", c.sound);
      speak(lastRound && preset.rounds > 1 ? "Última rodada. Vai!" : preset.rounds > 1 ? `Rodada ${sg.round}` : "Vai!", c.voice);
      vibrate("start", c.vibrate);
    } else {
      playSound("rest", c.sound);
      speak(PHASE_LABEL[sg.phase], c.voice);
      vibrate("rest", c.vibrate);
    }
  };

  const enter = (index, startAt, silent) => {
    const e = eng.current;
    e.i = index;
    e.endAt = startAt + segs[index].dur * 1000;
    e.lastSec = null;
    if (!silent) announce(index);
    setView({ i: index, remMs: segs[index].dur * 1000, paused: e.paused, finished: false });
  };

  const finish = () => {
    const e = eng.current;
    e.finished = true;
    clearInterval(e.timer);
    playSound("end", cfg.current.sound);
    speak("Treino concluído. Bom trabalho!", cfg.current.voice);
    vibrate("end", cfg.current.vibrate);
    stopKeepAlive();
    setView((v) => ({ ...v, finished: true, remMs: 0 }));
  };

  const tick = () => {
    const e = eng.current;
    if (e.paused || e.finished) return;
    const now = Date.now();
    let moved = false;
    while (now >= e.endAt) {
      if (e.i >= segs.length - 1) {
        finish();
        return;
      }
      const nextStart = e.endAt;
      e.i += 1;
      e.endAt = nextStart + segs[e.i].dur * 1000;
      moved = true;
    }
    if (moved) enter(e.i, e.endAt - segs[e.i].dur * 1000, false);
    const rem = e.endAt - now;
    const sec = Math.ceil(rem / 1000);
    if (sec !== e.lastSec) {
      e.lastSec = sec;
      if (sec >= 1 && sec <= 3 && segs[e.i].dur > 3) {
        playSound("tick", cfg.current.sound);
        vibrate("tick", cfg.current.vibrate);
      }
    }
    setView({ i: e.i, remMs: rem, paused: false, finished: false });
  };

  useEffect(() => {
    startKeepAlive();
    enter(0, Date.now(), false);
    eng.current.timer = setInterval(tick, 100);
    return () => {
      clearInterval(eng.current.timer);
      stopKeepAlive();
      try {
        Speech.stop();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = () => {
    const e = eng.current;
    if (e.finished) return;
    if (e.paused) {
      e.paused = false;
      e.endAt = Date.now() + e.remMs;
      startKeepAlive();
      setView((v) => ({ ...v, paused: false }));
    } else {
      e.paused = true;
      e.remMs = Math.max(0, e.endAt - Date.now());
      try {
        Speech.stop();
      } catch (er) {}
      stopKeepAlive();
      setView((v) => ({ ...v, paused: true, remMs: e.remMs }));
    }
  };

  const jump = (index) => {
    const e = eng.current;
    if (e.finished) return;
    const i = Math.max(0, Math.min(segs.length - 1, index));
    enter(i, Date.now(), false);
    if (e.paused) e.remMs = e.endAt - Date.now();
  };

  const prev = () => {
    const e = eng.current;
    const rem = e.paused ? e.remMs : e.endAt - Date.now();
    const elapsedInSeg = segs[e.i].dur * 1000 - rem;
    jump(elapsedInSeg > 2000 ? e.i : e.i - 1);
  };

  const close = () => {
    if (eng.current.finished) return onClose();
    Alert.alert("Encerrar treino", "Quer encerrar o treino agora?", [
      { text: "Continuar", style: "cancel" },
      { text: "Encerrar", style: "destructive", onPress: onClose },
    ]);
  };

  // Botão voltar do Android na tela de treino
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seg = segs[view.i];
  const phase = view.finished ? "done" : seg.phase;
  const colors = PHASE_COLORS[phase];
  const elapsed = view.finished ? total : starts[view.i] + (seg.dur * 1000 - view.remMs) / 1000;
  const next = segs[view.i + 1];
  let counter = "";
  if (!view.finished && (seg.phase === "work" || seg.phase === "rest" || seg.phase === "setrest")) {
    counter = `Rodada ${seg.round} de ${preset.rounds}`;
    if (preset.sets > 1) counter += ` · Série ${seg.set} de ${preset.sets}`;
  }
  if (view.finished) counter = `${fmt(total)} de treino`;

  return (
    <SafeAreaView style={[run.screen, { backgroundColor: colors.bg }]} edges={["top", "left", "right", "bottom"]}>
      <View style={run.top}>
        <Text style={[run.name, { color: colors.fg }]} numberOfLines={1}>{preset.name}</Text>
        <Pressable style={run.closeBtn} onPress={close} accessibilityLabel="Encerrar treino">
          <Text style={{ color: colors.fg, fontSize: 20 }}>✕</Text>
        </Pressable>
      </View>

      <Pressable style={run.mid} onPress={togglePause}>
        <Text style={[run.phase, { color: colors.fg }]} adjustsFontSizeToFit numberOfLines={1}>
          {PHASE_LABEL[phase]}
        </Text>
        <Text style={[run.clock, { color: colors.fg }]} adjustsFontSizeToFit numberOfLines={1}>
          {view.finished ? "✓" : fmt(Math.ceil(view.remMs / 1000))}
        </Text>
        <Text style={[run.count, { color: colors.fg }]}>{counter}</Text>
        <Text style={[run.next, { color: colors.fg }]}>
          {view.finished ? "" : next ? `A seguir: ${PHASE_LABEL[next.phase]} ${fmt(next.dur)}` : "Último bloco"}
        </Text>
        {view.paused && <Text style={[run.paused, { color: colors.fg }]}>PAUSADO</Text>}
      </Pressable>

      <View style={[run.track, { backgroundColor: colors.fg + "40" }]}>
        <View style={{ width: `${Math.min(100, (elapsed / total) * 100)}%`, height: "100%", backgroundColor: colors.fg, borderRadius: 99 }} />
      </View>
      <View style={run.times}>
        <Text style={{ color: colors.fg, opacity: 0.8 }}>{fmt(elapsed)}</Text>
        <Text style={{ color: colors.fg, opacity: 0.8 }}>-{fmt(total - elapsed)}</Text>
      </View>

      <View style={run.ctrl}>
        <Pressable style={[run.btn, { backgroundColor: colors.fg + "33" }]} onPress={prev} accessibilityLabel="Voltar">
          <Text style={{ color: colors.fg, fontSize: 26 }}>⏮</Text>
        </Pressable>
        <Pressable style={[run.btn, run.big, { backgroundColor: colors.fg }]} onPress={togglePause} accessibilityLabel={view.paused ? "Continuar" : "Pausar"}>
          <Text style={{ color: colors.bg, fontSize: 36 }}>{view.paused ? "▶" : "❚❚"}</Text>
        </Pressable>
        <Pressable style={[run.btn, { backgroundColor: colors.fg + "33" }]} onPress={() => jump(view.i + 1)} accessibilityLabel="Pular">
          <Text style={{ color: colors.fg, fontSize: 26 }}>⏭</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ============================================================
   Estilos
   ============================================================ */
const styles = (t) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12 },
    h1: { fontSize: 44, fontWeight: "800", color: t.ink, letterSpacing: -0.5 },
    h2: { fontSize: 34, fontWeight: "800", color: t.ink, marginVertical: 8, letterSpacing: -0.5 },
    iconBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    empty: { color: t.muted, textAlign: "center", paddingVertical: 40, fontSize: 16 },
    card: { flexDirection: "row", backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 18, overflow: "hidden" },
    cardMain: { flex: 1, padding: 16, paddingLeft: 18 },
    cardName: { fontSize: 24, fontWeight: "800", color: t.ink, marginBottom: 4 },
    cardMeta: { color: t.muted, fontSize: 15 },
    cardTotal: { color: t.ink, fontSize: 20, fontWeight: "700", marginTop: 6 },
    cardEdit: { width: 52, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: t.line },
    cardGo: { width: 72, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" },
    fabWrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
    fab: { backgroundColor: t.ink, paddingVertical: 15, paddingHorizontal: 26, borderRadius: 999, marginBottom: 12 },
    fabText: { color: t.bg, fontWeight: "700", fontSize: 17 },
    field: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 16, paddingHorizontal: 16, marginBottom: 14 },
    nameInput: { fontSize: 26, fontWeight: "700", color: t.ink, paddingVertical: 14 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.line, gap: 10 },
    rowLab: { fontSize: 17, color: t.ink },
    rowSub: { fontSize: 13, color: t.muted },
    stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
    stepBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    stepBtnText: { fontSize: 24, color: t.ink, lineHeight: 28 },
    stepVal: { minWidth: 62, textAlign: "center", fontSize: 24, fontWeight: "700", color: t.ink, fontVariant: ["tabular-nums"] },
    summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 4, paddingBottom: 14 },
    summaryVal: { fontSize: 30, fontWeight: "800", color: t.ink },
    bar: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg },
    barBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
    barText: { fontSize: 17, fontWeight: "600", color: t.ink },
    linkBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, marginBottom: 10 },
    note: { color: t.muted, fontSize: 15, marginTop: 8, lineHeight: 21 },
  });

const run = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, paddingBottom: 8 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 6 },
  name: { fontSize: 22, fontWeight: "700", flex: 1 },
  closeBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  mid: { flex: 1, alignItems: "center", justifyContent: "center" },
  phase: { fontSize: 56, fontWeight: "800", letterSpacing: -0.5, maxWidth: "100%" },
  clock: { fontSize: 200, fontWeight: "800", fontVariant: ["tabular-nums"], maxWidth: "100%", lineHeight: 210 },
  count: { fontSize: 20, fontWeight: "600", opacity: 0.9 },
  next: { fontSize: 17, opacity: 0.75, marginTop: 8, minHeight: 24 },
  paused: { marginTop: 10, fontSize: 18, fontWeight: "800", letterSpacing: 2 },
  track: { height: 8, borderRadius: 99, overflow: "hidden", marginHorizontal: 2, marginBottom: 8 },
  times: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2, marginBottom: 14 },
  ctrl: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22, paddingBottom: 8 },
  btn: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  big: { width: 96, height: 96, borderRadius: 48 },
});

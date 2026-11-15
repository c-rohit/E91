"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  basisAngle,
  basisLabel,
  correctedBobBit,
  measureEntangledPair,
  type Basis,
  type EntanglementMode,
} from "@/lib/entanglement";
import {
  initializeRandomness,
  type RandomnessDetails,
  type RandomnessEngine,
} from "@/lib/randomness";

const ITERATION_LIMIT = 256;
const DEFAULT_THRESHOLD = 11;
const DEFAULT_SAMPLE_PERCENT = 25;

interface MeasurementRecord {
  iteration: number;
  aliceBasis: Basis;
  bobBasis: Basis;
  mode: EntanglementMode;
  aliceBit: 0 | 1;
  bobRaw: 0 | 1;
  bobCorrected: 0 | 1;
  eveIntercepted: boolean;
  eveAngle?: number;
  randomValues: {
    alice: number;
    relation: number;
    evePolarization?: number;
    bobMeasurement: number;
    visuals: [number, number];
  };
  completed: true;
}

interface ComparisonRow extends MeasurementRecord {
  status: "Kept" | "Discarded";
}

interface ActivePair {
  iteration: number;
  aliceBasis: Basis;
  bobBasis: Basis;
  mode: EntanglementMode;
  eveIntercepted: boolean;
  aliceBit: 0 | 1;
  bobRaw: 0 | 1;
  bobCorrected: 0 | 1;
  aliceRandom: number;
  relationRandom: number;
  bobRandom: number;
  eveRandom?: number;
  eveAngle?: number;
  aliceVisualAngle: number;
  bobVisualAngle: number;
  phase: "traveling" | "intercepted" | "replacement" | "measured";
  aliceMeasured: boolean;
};

interface SecurityResult {
  sampled: number;
  mismatches: number;
  qber: number;
  threshold: number;
  passed: boolean;
  sampleIterations: number[];
  message: string;
}

function PhotonGlyph({
  party,
  active,
  hovered,
  onHover,
}: {
  party: "alice" | "bob";
  active: ActivePair;
  hovered: boolean;
  onHover: (party: "alice" | "bob" | null) => void;
}) {
  const isAlice = party === "alice";
  const color = isAlice ? "#149bd7" : "#7868d9";
  const measured = isAlice ? active.aliceMeasured : active.phase === "measured";
  const angle =
    (isAlice ? active.aliceVisualAngle : active.bobVisualAngle) +
    (isAlice ? 1 : -1) * ((Date.now() - active.iteration) % 3600) * 0.045;
  const randomValue = isAlice ? active.aliceRandom : active.bobRandom;
  const className = isAlice
    ? `photon-flight photon-a ${measured ? "photon-paused" : ""}`
    : active.eveIntercepted
      ? `photon-flight photon-replacement ${active.phase === "replacement" ? "replacement-active" : ""} ${measured ? "photon-paused" : ""}`
      : `photon-flight photon-b ${measured ? "photon-paused" : ""}`;
  const origin = !isAlice && active.eveIntercepted ? 570 : 432;

  if (!isAlice && active.eveIntercepted && active.phase === "traveling") {
    return (
      <g transform="translate(432 174)">
        <g
          className={`photon-flight photon-to-eve ${hovered ? "photon-hovered" : ""}`}
          onMouseEnter={() => onHover(party)}
          onMouseLeave={() => onHover(null)}
          tabIndex={0}
          role="img"
          aria-label="Original photon B traveling to Eve"
        >
          <circle r="19" fill={color} opacity=".13" className="photon-halo" />
          <circle r="8" fill={color} className="photon-core" />
          <text x="0" y="31" textAnchor="middle" className="photon-label">B</text>
        </g>
      </g>
    );
  }

  return (
    <g transform={`translate(${origin} 174)`}>
      <g
        className={`${className} ${hovered ? "photon-hovered" : ""}`}
        onMouseEnter={() => onHover(party)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(party)}
        onBlur={() => onHover(null)}
        tabIndex={0}
        role="img"
        aria-label={`${isAlice ? "Photon A" : active.eveIntercepted ? "Eve's replacement photon B" : "Photon B"}, animated polarization visualization`}
      >
        <circle r="19" fill={color} opacity=".13" className="photon-halo" />
        <circle r="8" fill={color} className="photon-core" />
        <text x="0" y="31" textAnchor="middle" className="photon-label">
          {isAlice ? "A" : "B"}
        </text>
        <title>
          {isAlice ? "Photon A" : "Photon B"} |{" "}
          {((angle % 180) + 180).toFixed(1)}° visualization | iteration{" "}
          {active.iteration} | {measured ? "measured" : "in flight"} | r ={" "}
          {randomValue.toFixed(5)}
        </title>
      </g>
    </g>
  );
}

function basisText(basis: Basis) {
  return {
    name: basis === "rectilinear" ? "Rectilinear" : "Diagonal",
    angles: basis === "rectilinear" ? "0° / 90°" : "45° / 135°",
  };
}

function formatBits(bits: (0 | 1)[]) {
  return bits.length ? bits.join("") : "—";
}

function toHex(bits: (0 | 1)[]) {
  if (bits.length === 0) return "—";
  const binary = bits.join("").padStart(Math.ceil(bits.length / 4) * 4, "0");
  return `0x${(binary.match(/.{4}/g) ?? [])
    .map((nibble) => Number.parseInt(nibble, 2).toString(16))
    .join("")
    .toUpperCase()}`;
}

function measureReplacementPhoton(
  polarizationAngle: number,
  basis: Basis,
  randomValue: number,
): 0 | 1 {
  const probabilityZero = Math.cos(polarizationAngle - basisAngle(basis)) ** 2;
  return (randomValue < probabilityZero ? 0 : 1) as 0 | 1;
}

export default function QKDSimulator() {
  const [aliceBasis, setAliceBasis] = useState<Basis>("rectilinear");
  const [bobBasis, setBobBasis] = useState<Basis>("rectilinear");
  const [mode, setMode] = useState<EntanglementMode>("correlated");
  const [eveEnabled, setEveEnabled] = useState(false);
  const [results, setResults] = useState<MeasurementRecord[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [activePair, setActivePair] = useState<ActivePair | null>(null);
  const [randomness, setRandomness] = useState<RandomnessDetails | null>(null);
  const [prngOutput, setPrngOutput] = useState("Awaiting first sample");
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [security, setSecurity] = useState<SecurityResult | null>(null);
  const [samplePercent, setSamplePercent] = useState(DEFAULT_SAMPLE_PERCENT);
  const [qberThreshold, setQberThreshold] = useState(DEFAULT_THRESHOLD);
  const [status, setStatus] = useState("Ready");
  const [hoveredPhoton, setHoveredPhoton] = useState<"alice" | "bob" | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");

  const engineRef = useRef<RandomnessEngine | null>(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const comparingRef = useRef(false);
  const requestIdRef = useRef(0);
  const iterationRef = useRef(0);
  const aliceBasisRef = useRef(aliceBasis);
  const bobBasisRef = useRef(bobBasis);
  const modeRef = useRef(mode);
  const eveRef = useRef(eveEnabled);
  const activeRef = useRef<ActivePair | null>(null);
  const resultsRef = useRef<MeasurementRecord[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const rowsEndRef = useRef<HTMLTableRowElement>(null);

  aliceBasisRef.current = aliceBasis;
  bobBasisRef.current = bobBasis;
  modeRef.current = mode;
  eveRef.current = eveEnabled;
  activeRef.current = activePair;
  resultsRef.current = results;

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const clearScheduled = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const launchNextPair = useCallback(async () => {
    if (!runningRef.current) return;
    if (iterationRef.current >= ITERATION_LIMIT) {
      runningRef.current = false;
      setIsRunning(false);
      setStatus("Transmission complete · 256 pairs");
      return;
    }

    const engine = engineRef.current;
    if (!engine) {
      runningRef.current = false;
      setIsRunning(false);
      setStatus("Error · randomness engine unavailable");
      return;
    }

    const lockedAliceBasis = aliceBasisRef.current;
    const lockedBobBasis = bobBasisRef.current;
    const lockedMode = modeRef.current;
    const lockedEve = eveRef.current;
    try {
      const samples = await Promise.all(
        Array.from({ length: lockedEve ? 6 : 5 }, () => engine.next()),
      );
      if (!runningRef.current) return;

      const [randomAlice, randomRelation, randomBob, randomAliceVisual, randomBobVisual] =
        samples;
      const outcomes = measureEntangledPair(
        lockedAliceBasis,
        lockedBobBasis,
        lockedMode,
        randomAlice,
        randomRelation,
      );
      const iteration = iterationRef.current + 1;
      iterationRef.current = iteration;
      const eveRandom = lockedEve ? samples[5] : undefined;
      const eveAngle = eveRandom === undefined ? undefined : eveRandom * Math.PI;
      const bobRaw =
        eveAngle === undefined
          ? outcomes.bobRaw
          : measureReplacementPhoton(eveAngle, lockedBobBasis, randomBob);
      const pair: ActivePair = {
        iteration,
        aliceBasis: lockedAliceBasis,
        bobBasis: lockedBobBasis,
        mode: lockedMode,
        eveIntercepted: lockedEve,
        aliceBit: outcomes.alice,
        bobRaw,
        bobCorrected: correctedBobBit(bobRaw, lockedMode),
        aliceRandom: randomAlice,
        relationRandom: randomRelation,
        bobRandom: randomBob,
        eveRandom,
        eveAngle,
        aliceVisualAngle: randomAliceVisual * 180,
        bobVisualAngle: (eveAngle ?? randomBobVisual * Math.PI) * (180 / Math.PI),
        phase: "traveling",
        aliceMeasured: false,
      };

      setPrngOutput(engine.currentOutput);
      setElapsed(0);
      setActivePair(pair);
      setStatus(`Pair ${iteration} in flight`);
    } catch (error) {
      runningRef.current = false;
      setIsRunning(false);
      setStatus(
        error instanceof Error
          ? `Error · ${error.message}`
          : "Error · unable to generate photon pair",
      );
    }
  }, []);

  useEffect(() => {
    if (!activePair) return;
    const iteration = activePair.iteration;
    const aliceTimer = schedule(() => {
      const current = activeRef.current;
      if (!current || current.iteration !== iteration) return;
      setActivePair({ ...current, aliceMeasured: true });
      setStatus(`Alice measured pair ${iteration}`);
    }, 1_050);

    const bobDelay = activePair.eveIntercepted ? 2_500 : 1_950;
    const interceptTimer = activePair.eveIntercepted
      ? schedule(() => {
          const current = activeRef.current;
          if (!current || current.iteration !== iteration) return;
          setActivePair({ ...current, phase: "intercepted" });
          setStatus(`Eve intercepted pair ${iteration} · original photon removed`);
          schedule(() => {
            const intercepted = activeRef.current;
            if (!intercepted || intercepted.iteration !== iteration) return;
            setActivePair({ ...intercepted, phase: "replacement" });
            setStatus(`Eve sent replacement photon · Bob measuring`);
          }, 350);
        }, 1_000)
      : undefined;

    const bobTimer = schedule(() => {
      const current = activeRef.current;
      if (!current || current.iteration !== iteration) return;
      setActivePair({ ...current, phase: "measured" });
      setStatus(`Bob measured pair ${iteration}`);
      schedule(() => {
        const measured = activeRef.current;
        if (!measured || measured.iteration !== iteration) return;
        const record: MeasurementRecord = {
          iteration,
          aliceBasis: measured.aliceBasis,
          bobBasis: measured.bobBasis,
          mode: measured.mode,
          aliceBit: measured.aliceBit,
          bobRaw: measured.bobRaw,
          bobCorrected: measured.bobCorrected,
          eveIntercepted: measured.eveIntercepted,
          ...(measured.eveAngle === undefined
            ? {}
            : { eveAngle: (measured.eveAngle * 180) / Math.PI }),
          randomValues: {
            alice: measured.aliceRandom,
            relation: measured.relationRandom,
            ...(measured.eveAngle === undefined
              ? {}
              : { evePolarization: measured.eveRandom }),
            bobMeasurement: measured.bobRandom,
            visuals: [measured.aliceVisualAngle, measured.bobVisualAngle],
          },
          completed: true,
        };
        resultsRef.current = [...resultsRef.current, record];
        setResults(resultsRef.current);
        setActivePair(null);
        if (runningRef.current) {
          setStatus(`Pair ${iteration} stored · preparing next pair`);
          schedule(() => void launchNextPair(), 240);
        } else {
          setStatus(`Stopped · ${resultsRef.current.length} complete pairs stored`);
        }
      }, 320);
    }, bobDelay);

    return () => {
      clearTimeout(aliceTimer);
      clearTimeout(bobTimer);
      if (interceptTimer) clearTimeout(interceptTimer);
      timersRef.current.delete(aliceTimer);
      timersRef.current.delete(bobTimer);
      if (interceptTimer) timersRef.current.delete(interceptTimer);
    };
  }, [activePair?.iteration, activePair?.eveIntercepted, launchNextPair, schedule]);

  useEffect(() => {
    if (!activePair) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 100), 100);
    return () => window.clearInterval(timer);
  }, [activePair?.iteration]);

  useEffect(() => {
    if (comparisonRows.length) {
      rowsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [comparisonRows.length]);

  useEffect(
    () => () => {
      clearScheduled();
    },
    [clearScheduled],
  );

  const start = async () => {
    if (
      runningRef.current ||
      startingRef.current ||
      activeRef.current ||
      iterationRef.current >= ITERATION_LIMIT ||
      comparisonRows.length > 0 ||
      security
    ) {
      return;
    }

    startingRef.current = true;
    setIsStarting(true);
    setStatus("Initializing environmental randomness…");
    const requestId = ++requestIdRef.current;
    try {
      const engine = await initializeRandomness();
      if (requestId !== requestIdRef.current) return;
      engineRef.current = engine;
      setRandomness(engine.details);
      setPrngOutput("Awaiting first sample");
      startingRef.current = false;
      setIsStarting(false);
      runningRef.current = true;
      setIsRunning(true);
      setStatus("Transmission running");
      void launchNextPair();
    } catch (error) {
      startingRef.current = false;
      setIsStarting(false);
      setStatus(
        error instanceof Error
          ? `Error · ${error.message}`
          : "Error · randomness initialization failed",
      );
    }
  };

  const stop = () => {
    if (startingRef.current) {
      requestIdRef.current += 1;
      startingRef.current = false;
      setIsStarting(false);
      setStatus("Stopped · initialization cancelled");
      return;
    }
    runningRef.current = false;
    setIsRunning(false);
    setStatus(activeRef.current ? "Stopping · current pair will finish" : "Stopped");
  };

  const reset = () => {
    requestIdRef.current += 1;
    runningRef.current = false;
    startingRef.current = false;
    comparingRef.current = false;
    iterationRef.current = 0;
    resultsRef.current = [];
    clearScheduled();
    setIsRunning(false);
    setIsStarting(false);
    setIsComparing(false);
    setResults([]);
    setComparisonRows([]);
    setSecurity(null);
    setActivePair(null);
    setRandomness(null);
    setPrngOutput("Awaiting first sample");
    setStatus("Ready");
    setCopyStatus("");
    engineRef.current = null;
  };

  const compare = async () => {
    if (
      comparingRef.current ||
      isRunning ||
      isStarting ||
      activePair ||
      results.length === 0 ||
      comparisonRows.length > 0 ||
      isComparing
    ) {
      return;
    }
    comparingRef.current = true;
    setIsComparing(true);
    setStatus("Comparing stored measurements…");
    setSecurity(null);
    setComparisonRows([]);

    const compared: ComparisonRow[] = [];
    for (const result of results) {
      if (!comparingRef.current) return;
      compared.push({
        ...result,
        status: result.aliceBasis === result.bobBasis ? "Kept" : "Discarded",
      });
      setComparisonRows([...compared]);
      await new Promise<void>((resolve) => schedule(resolve, 55));
    }

    comparingRef.current = false;
    setIsComparing(false);
    setStatus(`Comparison complete · ${compared.filter((row) => row.status === "Kept").length} sifted bits`);
  };

  const checkSecurity = async () => {
    if (security || isComparing || comparingRef.current || comparisonRows.length === 0) {
      return;
    }
    const sifted = comparisonRows.filter((row) => row.status === "Kept");
    const count =
      sifted.length < 2
        ? 0
        : Math.min(
            sifted.length - 1,
            Math.max(1, Math.round((sifted.length * samplePercent) / 100)),
          );
    if (count === 0) {
      setSecurity({
        sampled: 0,
        mismatches: 0,
        qber: 0,
        threshold: qberThreshold,
        passed: false,
        sampleIterations: [],
        message:
          "Insufficient sifted bits for eavesdropping verification. Run a longer transmission before retaining a key.",
      });
      setStatus("Security check unavailable · insufficient sifted bits");
      return;
    }

    const engine = engineRef.current;
    if (!engine) {
      setStatus("Error · randomness engine unavailable for security sampling");
      return;
    }

    try {
      const indices = sifted.map((_, index) => index);
      for (let index = indices.length - 1; index > 0; index -= 1) {
        const random = await engine.next();
        const swapIndex = Math.floor(random * (index + 1));
        [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
      }
      const selected = indices
        .slice(0, count)
        .map((index) => sifted[index])
        .sort((left, right) => left.iteration - right.iteration);
      const mismatches = selected.filter(
        (row) => row.aliceBit !== row.bobCorrected,
      ).length;
      const qber = (mismatches / selected.length) * 100;
      const passed = qber <= qberThreshold;
      setSecurity({
        sampled: selected.length,
        mismatches,
        qber,
        threshold: qberThreshold,
        passed,
        sampleIterations: selected.map((row) => row.iteration),
        message: passed
          ? "No significant eavesdropping detected."
          : "Possible eavesdropping detected! The transmission may have been compromised.",
      });
      setPrngOutput(engine.currentOutput);
      setStatus(passed ? "Security check passed" : "Security check failed · preliminary key discarded");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Error · security check failed: ${error.message}`
          : "Error · security sampling failed",
      );
    }
  };

  const siftedRows = comparisonRows.filter((row) => row.status === "Kept");
  const sampleIterations = new Set(security?.sampleIterations ?? []);
  const remainingRows =
    security?.passed
      ? siftedRows.filter((row) => !sampleIterations.has(row.iteration))
      : [];
  const aliceKey = remainingRows.map((row) => row.aliceBit);
  const bobKey = remainingRows.map((row) => row.bobCorrected);
  const finalBits = formatBits(aliceKey);
  const keysMatch = security?.passed === true && aliceKey.join("") === bobKey.join("");
  const comparisonComplete =
    !isComparing &&
    results.length > 0 &&
    comparisonRows.length === results.length;
  const qber = security?.qber ?? 0;
  const progress = (results.length / ITERATION_LIMIT) * 100;
  const currentAngle = (party: "alice" | "bob") => {
    if (!activePair) return "—";
    const base =
      party === "alice"
        ? activePair.aliceVisualAngle
        : activePair.bobVisualAngle;
    return `${((base + elapsed * (party === "alice" ? 0.045 : -0.045)) % 180).toFixed(1)}°`;
  };
  const currentRandom = (party: "alice" | "bob") => {
    if (!activePair) return "—";
    return (party === "alice" ? activePair.aliceRandom : activePair.bobRandom).toFixed(6);
  };
  const copyKey = async () => {
    if (!security?.passed || !aliceKey.length) return;
    try {
      await navigator.clipboard.writeText(aliceKey.join(""));
      setCopyStatus("Copied to clipboard.");
    } catch {
      setCopyStatus("Clipboard access was denied by the browser.");
    }
    schedule(() => setCopyStatus(""), 2_500);
  };

  const toggleBasis = (party: "alice" | "bob") => {
    const setter = party === "alice" ? setAliceBasis : setBobBasis;
    setter((current) =>
      current === "rectilinear" ? "diagonal" : "rectilinear",
    );
  };

  return (
    <main className="lab-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Entanglement Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><b /></span>
          <span>
            <strong>E91</strong>
            <small>QUANTUM KEY DISTRIBUTION</small>
          </span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><i />SIMULATOR ONLINE</span>
          <span className="version-tag">v1.02</span>
        </div>
      </header>

      <section className="intro-row">
        <div>
          <div className="eyebrow">ARTUR EKERT · 1991</div>
          <h1>Quantum Key Distribution <em>Simulator</em></h1>
          <p>Transmit entangled photon pairs, compare measurement bases, and test the sifted key for interception.</p>
        </div>
        <div className="mode-control">
          <div className="micro-label">PAIR CORRELATION</div>
          <div className="segmented-control" role="group" aria-label="Entanglement mode">
            <button type="button" className={mode === "correlated" ? "selected" : ""} onClick={() => setMode("correlated")}>
              <span className="mode-symbol">↗↗</span> CORRELATED
            </button>
            <button type="button" className={mode === "anticorrelated" ? "selected" : ""} onClick={() => setMode("anticorrelated")}>
              <span className="mode-symbol">↗↙</span> ANTICORRELATED
            </button>
          </div>
        </div>
      </section>

      <section className="instrument-panel">
        <div className="panel-heading">
          <div>
            <span className="section-index">01 / SETUP</span>
            <h2>Optical bench</h2>
          </div>
          <div className="bench-legend">
            <span><i className="legend-dot alice-dot" /> PHOTON A</span>
            <span><i className="legend-dot bob-dot" /> PHOTON B</span>
            <span className="bench-coordinates">BENCH AXIS · 2D</span>
          </div>
        </div>

        <div className="optical-stage">
          <div className="spin-monitor" aria-label="Live photon spin monitor">
            <div className="spin-monitor-title"><span /> LIVE PHOTON SPIN · VISUAL ONLY</div>
            <div className="spin-monitor-readings">
              <div className="spin-reading alice-reading">
                <span className="spin-axis" style={{ transform: `rotate(${activePair ? currentAngle("alice") : "0deg"})` }}><i /><b /></span>
                <span><small>PHOTON A · SPIN</small><strong>{activePair ? currentAngle("alice") : "READY"}</strong></span>
                <em>{activePair?.aliceMeasured ? "MEASURED" : activePair ? "IN TRANSIT" : "AWAITING PAIR"}</em>
              </div>
              <div className="spin-reading bob-reading">
                <span className="spin-axis" style={{ transform: `rotate(${activePair ? currentAngle("bob") : "45deg"})` }}><i /><b /></span>
                <span><small>PHOTON B · SPIN</small><strong>{activePair ? currentAngle("bob") : "READY"}</strong></span>
                <em>{activePair ? activePair.phase === "measured" ? "MEASURED" : activePair.phase === "intercepted" ? "INTERCEPTED" : "IN TRANSIT" : "AWAITING PAIR"}</em>
              </div>
            </div>
          </div>
          <svg
            className="optical-svg"
            viewBox="0 0 1000 340"
            role="img"
            aria-label="Entanglement experiment: Alice, photon source, Eve interception point, Bob analyzer"
          >
            <defs>
              <linearGradient id="alicePath" x1="1" x2="0">
                <stop offset="0" stopColor="#199ed8" stopOpacity=".8" />
                <stop offset="1" stopColor="#199ed8" stopOpacity=".14" />
              </linearGradient>
              <linearGradient id="bobPath" x1="0" x2="1">
                <stop offset="0" stopColor="#7566d5" stopOpacity=".75" />
                <stop offset="1" stopColor="#7566d5" stopOpacity=".12" />
              </linearGradient>
            </defs>
            <path d="M 75 174 H 250 M 250 174 H 432" className="optical-rail alice-rail" />
            <path d="M 432 174 H 570 M 570 174 H 710 M 710 174 H 925" className="optical-rail bob-rail" />
            <path d="M 250 174 V 100 H 314 M 710 174 V 100 H 776" className="branch-rail" />
            <path d="M 250 174 V 248 H 314 M 710 174 V 248 H 776" className="branch-rail" />

            <rect x="212" y="136" width="76" height="76" rx="9" className="analyzer-housing alice-housing" />
            <foreignObject x="229" y="153" width="42" height="42">
              <button
                className="in-bench-switch alice-bench-switch"
                type="button"
                onClick={() => toggleBasis("alice")}
                aria-label={`Alice basis: ${basisLabel(aliceBasis)}. Click to switch basis.`}
                title={`Alice ${basisLabel(aliceBasis)} analyzer · click to switch`}
              >
                <span className={`in-bench-axis ${aliceBasis}`}><i /><b /></span>
              </button>
            </foreignObject>
            <text x="250" y="230" textAnchor="middle" className="basis-label-svg">{aliceBasis === "rectilinear" ? "RECTILINEAR +" : "DIAGONAL ×"}</text>
            <text x="250" y="278" textAnchor="middle" className="apparatus-label">PBS</text>
            <text x="250" y="295" textAnchor="middle" className="apparatus-caption">BEAM SPLITTER</text>
            <circle cx="314" cy="100" r="13" className={`detector detector-a0 ${activePair?.aliceMeasured && activePair.aliceBit === 0 ? "activated" : ""}`} />
            <circle cx="314" cy="248" r="13" className={`detector detector-a1 ${activePair?.aliceMeasured && activePair.aliceBit === 1 ? "activated" : ""}`} />
            <text x="314" y="78" textAnchor="middle" className="detector-label">D₀</text>
            <text x="314" y="277" textAnchor="middle" className="detector-label">D₁</text>

            <rect x="672" y="136" width="76" height="76" rx="9" className="analyzer-housing bob-housing" />
            <foreignObject x="689" y="153" width="42" height="42">
              <button
                className="in-bench-switch bob-bench-switch"
                type="button"
                onClick={() => toggleBasis("bob")}
                aria-label={`Bob basis: ${basisLabel(bobBasis)}. Click to switch basis.`}
                title={`Bob ${basisLabel(bobBasis)} analyzer · click to switch`}
              >
                <span className={`in-bench-axis ${bobBasis}`}><i /><b /></span>
              </button>
            </foreignObject>
            <text x="710" y="230" textAnchor="middle" className="basis-label-svg">{bobBasis === "rectilinear" ? "RECTILINEAR +" : "DIAGONAL ×"}</text>
            <text x="710" y="278" textAnchor="middle" className="apparatus-label">ANALYZER</text>
            <text x="710" y="295" textAnchor="middle" className="apparatus-caption">POLARIZATION</text>
            <circle cx="776" cy="100" r="13" className={`detector detector-b0 ${activePair?.phase === "measured" && activePair.bobRaw === 0 ? "activated" : ""}`} />
            <circle cx="776" cy="248" r="13" className={`detector detector-b1 ${activePair?.phase === "measured" && activePair.bobRaw === 1 ? "activated" : ""}`} />
            <text x="776" y="78" textAnchor="middle" className="detector-label">D₀</text>
            <text x="776" y="277" textAnchor="middle" className="detector-label">D₁</text>

            <g className={`eve-unit ${eveEnabled ? "eve-on" : ""} ${activePair?.phase === "intercepted" ? "eve-capturing" : ""} ${activePair?.phase === "replacement" ? "eve-sending" : ""}`}>
              <circle cx="570" cy="174" r="25" className="eve-ring" />
              <circle cx="570" cy="174" r="15" className="eve-core" />
              <path d="M 563 174 H 577 M 570 167 V 181" className="eve-cross" />
              <text x="570" y="224" textAnchor="middle" className="apparatus-label">EVE</text>
              <text x="570" y="239" textAnchor="middle" className="apparatus-caption">{eveEnabled ? "INTERCEPT / RESEND" : "SECURE CHANNEL"}</text>
            </g>

            <g className="source-unit">
              <circle cx="432" cy="174" r="34" className="source-ring" />
              <circle cx="432" cy="174" r="21" className="source-core" />
              <path d="M 422 174 C 427 163 437 185 442 174" className="source-wave" />
              <text x="432" y="238" textAnchor="middle" className="source-label">ENTANGLED SOURCE</text>
              <text x="432" y="255" textAnchor="middle" className="apparatus-caption">BELL-PAIR EMITTER</text>
            </g>

            <g className="endpoint alice-endpoint">
              <rect x="48" y="143" width="74" height="62" rx="8" />
              <text x="85" y="169" textAnchor="middle">A</text>
              <text x="85" y="188" textAnchor="middle">ALICE</text>
            </g>
            <g className="endpoint bob-endpoint">
              <rect x="878" y="143" width="74" height="62" rx="8" />
              <text x="915" y="169" textAnchor="middle">B</text>
              <text x="915" y="188" textAnchor="middle">BOB</text>
            </g>

            {activePair && (
              <>
                <PhotonGlyph party="alice" active={activePair} hovered={hoveredPhoton === "alice"} onHover={setHoveredPhoton} />
                {activePair.phase !== "intercepted" && (
                  <PhotonGlyph party="bob" active={activePair} hovered={hoveredPhoton === "bob"} onHover={setHoveredPhoton} />
                )}
              </>
            )}
          </svg>
          <div className="stage-foot">
            <span>INDEPENDENT ARRIVALS</span>
            <span>
              {activePair
                ? `PAIR ${String(activePair.iteration).padStart(3, "0")} · ${activePair.phase.toUpperCase()}`
                : "AWAITING PAIR"}
            </span>
            <span>{eveEnabled ? "INTERCEPT / RESEND ENABLED" : "SECURE TRANSMISSION PATH"}</span>
          </div>
          {hoveredPhoton && activePair && (
            <div className={`photon-tooltip tooltip-${hoveredPhoton}`}>
              <div className="tooltip-title">
                <span>{hoveredPhoton === "alice" ? "PHOTON A" : "PHOTON B"}</span>
                <span>ITERATION {activePair.iteration}</span>
              </div>
              <strong>{currentAngle(hoveredPhoton)}</strong>
              <span>{activePair.phase === "measured" ? "Measurement registered" : "In flight · visual indicator"}</span>
              <small>PRNG SAMPLE · {currentRandom(hoveredPhoton)}</small>
              {activePair.eveIntercepted && <small className="debug-label">EVE DEBUG · REPLACEMENT PHOTON</small>}
            </div>
          )}
        </div>

        <div className="bench-controls">
          <div className="eve-control">
            <div className="eve-control-copy">
              <strong>Eve interception</strong>
              <small>{eveEnabled ? "ON — Interception active" : "OFF — Secure transmission path"}</small>
            </div>
            <button
              className={`eve-switch ${eveEnabled ? "on" : ""}`}
              type="button"
              role="switch"
              aria-checked={eveEnabled}
              aria-label="Toggle Eve interception"
              onClick={() => setEveEnabled((enabled) => !enabled)}
              disabled={isRunning || isStarting || !!activePair}
            >
              <span />
            </button>
            <span className={`eve-state ${eveEnabled ? "on" : ""}`}>{eveEnabled ? "ON" : "OFF"}</span>
          </div>
          <div className="bench-footnote">
            <span><b>!</b> Polarization marker is a changing visualization, not a pre-existing measurable photon state.</span>
            <span>Joint outcomes are sampled before detection.</span>
          </div>
        </div>
      </section>

      <section className="control-strip">
        <div className="run-controls">
          <button
            className="start-button"
            type="button"
            onClick={() => void start()}
            disabled={isRunning || isStarting || !!activePair || iterationRef.current >= ITERATION_LIMIT || comparisonRows.length > 0 || !!security}
          >
            <span aria-hidden="true">▶</span>{isStarting ? "INITIALIZING…" : "START"}
          </button>
          <button className="stop-button" type="button" onClick={stop} disabled={!isRunning && !isStarting}>
            <span aria-hidden="true">■</span> STOP
          </button>
          <button className="reset-button" type="button" onClick={reset} disabled={isRunning || isStarting || isComparing}>
            RESET
          </button>
          <div className="run-status">
            <i className={isRunning ? "status-running" : ""} />
            <span>{status}</span>
          </div>
        </div>
        <div className="progress-block">
          <div className="progress-heading"><span>ITERATION</span><strong>{results.length} <small>/ {ITERATION_LIMIT}</small></strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      <section className="stats-grid" aria-label="Simulation statistics">
        <div className="stat-card"><span className="stat-label">PHOTON PAIRS</span><strong>{results.length.toString().padStart(3, "0")}<small> / 256</small></strong><span className="stat-detail">fully measured</span></div>
        <div className="stat-card"><span className="stat-label">EVE INTERCEPTED</span><strong>{results.filter((result) => result.eveIntercepted).length.toString().padStart(3, "0")}</strong><span className="stat-detail">replacement photons sent</span></div>
        <div className="stat-card"><span className="stat-label">COMPARISON</span><strong className="cyan-number">{comparisonRows.length.toString().padStart(3, "0")}</strong><span className="stat-detail">of {results.length} records sifted</span></div>
        <div className="stat-card"><span className="stat-label">SIFTED BITS</span><strong>{siftedRows.length.toString().padStart(3, "0")}</strong><span className="stat-detail">same-basis measurements</span></div>
      </section>

      <section className="data-grid">
        <div className="instrument-panel results-panel">
          <div className="panel-heading results-heading">
            <div>
              <span className="section-index">02 / MEASUREMENT COMPARISON</span>
              <h2>Basis sift <span>{comparisonRows.length} / {results.length}</span></h2>
            </div>
            <button
              className="action-button"
              type="button"
              onClick={() => void compare()}
              disabled={results.length === 0 || isRunning || isStarting || !!activePair || isComparing || comparisonComplete || !!security}
            >
              {isComparing ? "COMPARING…" : comparisonComplete ? "COMPARED" : "COMPARE"}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ITERATION</th><th>A BASIS</th><th>A BIT</th><th>B BASIS</th><th>B BIT</th><th>STATUS</th></tr></thead>
              <tbody>
                {comparisonRows.length === 0 ? (
                  <tr className="empty-row"><td colSpan={6}><span className="empty-icon">⌁</span><strong>No measurement results compared yet. Click Compare to begin.</strong><small>{results.length ? `${results.length} completed measurement records are ready.` : "Run a transmission to collect measurement records."}</small></td></tr>
                ) : (
                  comparisonRows.map((row) => {
                    const isRevealed = sampleIterations.has(row.iteration);
                    const rowStatus = isRevealed ? "Revealed" : row.status;
                    return (
                      <tr
                        className={`result-row ${isRevealed ? "row-revealed" : row.status === "Kept" ? "row-kept" : "row-discarded"}`}
                        key={row.iteration}
                      >
                        <td className="mono">{row.iteration.toString().padStart(3, "0")}</td>
                        <td className="basis-cell">{basisText(row.aliceBasis).name}<small>{basisText(row.aliceBasis).angles}</small></td>
                        <td className="bit-cell">{row.aliceBit}</td>
                        <td className="basis-cell">{basisText(row.bobBasis).name}<small>{basisText(row.bobBasis).angles}</small></td>
                        <td className="bit-cell">{row.bobCorrected}</td>
                        <td>
                          <span className={`row-status ${isRevealed ? "revealed" : row.status === "Kept" ? "kept" : "discarded"}`}>{rowStatus}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
                <tr ref={rowsEndRef} className="scroll-anchor" aria-hidden="true"><td colSpan={6} /></tr>
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>ONLY MATCHING BASES ARE RETAINED</span>
            <span>BOB'S DISPLAYED BIT IS MODE-CORRECTED</span>
          </div>
        </div>

        <aside className="instrument-panel security-panel">
          <div className="panel-heading">
            <div><span className="section-index">03 / CHANNEL CHECK</span><h2>Security verification</h2></div>
            <span className={`security-badge ${security ? security.sampled === 0 ? "insufficient" : security.passed ? "passed" : "failed" : ""}`}>
              <i /> {security ? security.sampled === 0 ? "INSUFFICIENT" : security.passed ? "PASSED" : "FAILED" : "PENDING"}
            </span>
          </div>
          <div className="security-settings">
            <label>
              SAMPLE SIZE
              <span><input type="number" min="1" max="90" value={samplePercent} onChange={(event) => setSamplePercent(Math.min(90, Math.max(1, Number(event.target.value) || 1)))} disabled={!!security || !comparisonComplete} /> % of sifted bits</span>
            </label>
            <label>
              QBER THRESHOLD
              <span><input type="number" min="0" max="100" value={qberThreshold} onChange={(event) => setQberThreshold(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} disabled={!!security || !comparisonComplete} /> % max</span>
            </label>
          </div>
          <button
            className="action-button security-action"
            type="button"
            onClick={() => void checkSecurity()}
            disabled={!comparisonComplete || !!security || isComparing}
            title={!comparisonComplete ? "Complete Compare before checking the channel." : "Reveal a random sample and estimate the QBER."}
          >
            CHECK FOR EAVESDROPPING
          </button>
          {!comparisonComplete && <p className="stage-hint">Available after all stored measurements have been compared.</p>}
          {security && (
            <div className={`security-result ${security.sampled === 0 ? "insufficient" : security.passed ? "passed" : "failed"}`}>
              <div className="security-message">{security.message}</div>
              <div className="qber-meter">
                <div><span>QBER</span><strong>{security.sampled ? `${security.qber.toFixed(1)}%` : "—"}</strong></div>
                <div className="qber-track"><span style={{ width: `${Math.min(100, qber)}%` }} /><i style={{ left: `${security.threshold}%` }} /></div>
                <small>Allowed threshold · {security.threshold}%</small>
              </div>
              <div className="security-stats">
                <div><span>SIFTED BITS</span><strong>{siftedRows.length}</strong></div>
                <div><span>SAMPLED</span><strong>{security.sampled}</strong></div>
                <div><span>MISMATCHES</span><strong>{security.mismatches}</strong></div>
              </div>
              {security.passed && <p className="sample-note">Sampled bits ({security.sampleIterations.length}) are revealed and excluded from the final key.</p>}
              {!security.passed && security.sampled > 0 && <p className="warning-note">Preliminary key discarded. Start a new transmission before attempting to retain a key.</p>}
              {security.sampled === 0 && <p className="warning-note">Add more matching-basis measurements and compare again in a new transmission. No security conclusion was reached.</p>}
            </div>
          )}
        </aside>
      </section>

      <section className={`instrument-panel key-panel final-key-panel ${security?.passed ? "key-unlocked" : ""}`}>
        <div className="panel-heading">
          <div><span className="section-index">04 / FINAL SECRET</span><h2>Final key</h2></div>
          <span className={`key-match ${keysMatch ? "match" : ""}`}><i />{security?.passed ? keysMatch ? "KEYS IN SYNC" : "KEY MISMATCH" : "LOCKED"}</span>
        </div>
        {!security ? (
          <div className="locked-message"><span className="lock-symbol">◇</span><strong>Key generation is locked</strong><small>Compare results and pass the eavesdropping check before revealing the remaining secret bits.</small></div>
        ) : security.passed ? (
          <div className="final-key-content">
            <div className="key-stream-grid">
              <div className="key-stream"><div><span className="stream-dot alice-dot" /> ALICE REMAINING KEY</div><code>{finalBits}</code></div>
              <div className="key-stream"><div><span className="stream-dot bob-dot" /> BOB CORRECTED KEY</div><code>{formatBits(bobKey)}</code></div>
            </div>
            <div className="key-metrics">
              <div><span>SECRET BITS RETAINED</span><strong>{aliceKey.length}</strong></div>
              <div><span>SAMPLE REVEALED</span><strong>{security.sampled}</strong></div>
              <div><span>AGREEMENT</span><strong>{keysMatch ? "100" : "0"}<small>%</small></strong></div>
            </div>
            <div className="binary-key"><div><span>FINAL KEY · BINARY</span><span>{aliceKey.length} BITS</span></div><code>{finalBits}</code></div>
            <div className="hex-key"><span>HEX</span><code>{toHex(aliceKey)}</code><button type="button" onClick={() => void copyKey()} disabled={!aliceKey.length}>COPY KEY</button></div>
            <div className="copy-status" aria-live="polite">{copyStatus}</div>
            {aliceKey.length === 0 && <p className="warning-note">The revealed sample leaves no secret bits. Increase the transmission length for a usable key.</p>}
          </div>
        ) : security.sampled === 0 ? (
          <div className="key-discarded insufficient"><strong>Not enough sifted bits to test</strong><span>No security conclusion or final key is available. Reset and initiate a longer transmission.</span></div>
        ) : (
          <div className="key-discarded"><strong>Preliminary key discarded</strong><span>Possible channel compromise. No usable final secret is available; reset and initiate a new transmission.</span></div>
        )}
      </section>

      <details className="instrument-panel randomness-panel">
        <summary>
          <span><span className="section-index">05 / RANDOMNESS AUDIT</span><strong>Environmental seed &amp; PRNG</strong><small>Experimental deterministic randomness · not quantum randomness</small></span>
          <span className="random-summary">{randomness ? randomness.source.toUpperCase() : "NOT INITIALIZED"}<b>⌄</b></span>
        </summary>
        <div className="randomness-content">
          {!randomness ? <p>Start a transmission to generate the seed and retrieve the environmental readings.</p> : (
            <>
              <div className="seed-status"><span className="status-pip" /><span>{randomness.message}</span><strong>{randomness.source.toUpperCase()}</strong></div>
              <div className="seed-hash"><span>SHA-256 SEED HASH</span><code>{randomness.seedHash}</code></div>
              <div className="seed-hash prng-output"><span>LAST HMAC-SHA-256 PRNG OUTPUT · HEX (SHORT)</span><code>{prngOutput}</code></div>
              <div className="environment-table">
                <div className="environment-head"><span>LOCATION</span><span>COORDINATES</span><span>TEMP</span><span>HUMIDITY</span><span>WIND</span><span>PRESSURE</span></div>
                {randomness.coordinates.map((coordinate, index) => {
                  const reading = randomness.weather[index];
                  return <div className="environment-row" key={`${coordinate.latitude}-${coordinate.longitude}`}><span>POINT 0{index + 1}</span><code>{coordinate.latitude.toFixed(4)}°, {coordinate.longitude.toFixed(4)}°</code><span>{reading ? `${reading.temperature.toFixed(1)} °C` : "fallback"}</span><span>{reading ? `${reading.humidity.toFixed(0)} %` : "fallback"}</span><span>{reading ? `${reading.windSpeed.toFixed(1)} km/h` : "fallback"}</span><span>{reading ? `${reading.pressure.toFixed(1)} hPa` : "fallback"}</span></div>;
                })}
              </div>
              <p className="random-disclaimer">Weather data and timing seed the HMAC-SHA-256 counter generator. Weather failure uses Web Crypto directly. This is not a physical quantum random-number generator.</p>
            </>
          )}
        </div>
      </details>

      <footer className="page-footer">
        <div className="footer-description">
          <span>Statistical Bell-pair simulation · Educational security check · NOT a loophole-free Bell test</span>
        </div>
        <div className="footer-attribution">
          <span>Designed &amp; Developed by <span className="footer-name">Rohit C</span></span>
          <div className="footer-contact">
            <a href="https://www.rohitc.in" target="_blank" rel="noreferrer">www.rohitc.in</a>
            <span aria-hidden="true">|</span>
            <a href="mailto:official@rohitc.in">official@rohitc.in</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

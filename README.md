# Entanglement Lab

An interactive Next.js simulator for entanglement-based quantum key
distribution. It models correlated and anticorrelated Bell-pair measurements,
basis sifting, and progressive key generation.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use `npm run build` and
`npm start` for a production build.

## Simulation notes

- Alice's and Bob's basis and the selected entanglement mode are locked when
  each pair is generated. Their joint outcomes are sampled before either
  detection is shown, so the Alice-first animation does not imply
  instantaneous communication.
- Matching-basis measurements are kept. In anticorrelated mode Bob's raw bit is
  inverted before the comparison stage.
- Eve can be enabled for a transmission. She intercepts Bob's original photon,
  removes it from the path, and sends a new photon with an independently
  sampled polarization; Bob measures the replacement with the usual Malus-law
  probabilities.
- Completed measurements remain in a private in-memory result set until the
  user starts the sequential Compare stage. The QBER check then samples some
  sifted bits, reveals those test bits, and excludes them from any retained key.
  An insufficient sample or a QBER over the configured threshold prevents
  retaining a key.
- Reset starts a fresh transmission and clears the previous run's temporary
  measurements, comparison, and security-check state.
- The moving polarization marker is only a visualization; it is not presented
  as a definite, independently measurable photon polarization.
- On each run the client samples high-resolution timing and requests
  current weather for five generated coordinates from Open-Meteo through
  `/api/weather`. The material is SHA-256 hashed and used as an HMAC-SHA-256
  counter-generator seed. If weather retrieval fails, Web Crypto generates a
  fallback seed and the UI labels the source. Neither source is a physical
  quantum random-number generator.
- This is a statistical educational simulator, not a loophole-free Bell test
  or a production key-exchange system.

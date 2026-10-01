# Persona sample datasets

Bundled sample data for the persona templates (`PersonaTemplates`, HEL-1210). Each file is read from the
classpath when a user clicks a persona chip on the first-run surface, and is copied into that user's own CSV source.

## Provenance

All four files are **synthetic**. They were authored in this repository from deterministic arithmetic (seasonal
sine waves plus modular jitter); no row comes from a third-party dataset, a real person, a real company or any
scraped source. Merchant, game and service names are invented. They carry no licence obligation and may be
edited freely.

| File           | Persona  | Shape                                | Rows |
| -------------- | -------- | ------------------------------------ | ---- |
| `streamer.csv` | streamer | one stream per day for 60 days       | 60   |
| `founder.csv`  | founder  | 24 months x 4 acquisition channels   | 96   |
| `ops.csv`      | ops      | 45 days x 4 services                 | 180  |
| `finance.csv`  | finance  | 120 transactions across 6 categories | 120  |

## Rules

- A header row, then data rows; UTF-8; comma separated; every value is a plain string in the file (the template's
  pipeline `cast` step types the numeric columns).
- Keep each file small (the CI test `PersonaTemplatesSpec` enforces header schema, a row-count range and a
  size cap). Changing a header requires updating the matching template in `PersonaTemplates`.

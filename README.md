# ArenaGame

Browser-Prototyp eines Arena-Spiels: Gladiatoren kämpfen in Echtzeit-Autokämpfen, die man sich ansieht. Dieser Stand ist **Meilenstein 1**: die Kampf-Simulation und das Test-Tool zum Ausbalancieren.

## Starten

```bash
npm install
npm run dev        # Test-Tool im Browser
npm test           # automatische Tests
npm run balance    # alle Balance-Analysen in der Konsole
npm run balance -- steine --n 20000 --seed 3   # nur eine Analyse, mit mehr Kämpfen
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/sim/` | Die Simulation ohne Grafik: Typen, Zahlen (`config.ts`), Kampf (`combat.ts`), Stats und Kraft (`stats.ts`), Analysen (`analysis.ts`) |
| `src/tool/` | Das Test-Tool im Browser. Massensimulationen laufen in einem Web Worker. |
| `scripts/balance.ts` | Dieselben Analysen ohne Browser |
| `tests/` | Tests mit vitest |

Die Simulation ist deterministisch: gleiche Gladiatoren und gleicher Seed ergeben immer denselben Kampf. Der Kampf liefert eine Liste von Ereignissen, die Meilenstein 2 als Pixel-Kampf abspielt.

## Wie ein Kampf funktioniert

Die Kraft eines Gladiators ist **K = √((ATK + SPD/2) × (DEF + HP))**, Sondersteine geben einen Aufschlag auf K. Die Siegchance sagt die Formel **P(A) = K_A⁴ / (K_A⁴ + K_B⁴)** voraus.

Die Simulation ist so gebaut, dass diese Formel im Mittel stimmt:

- Schaden pro Sekunde wächst mit ATK + SPD/2.
- Aushalten wächst mit DEF + HP.
- Zufall sorgt für Überraschungen: Streuung pro Treffer, Krits, Ausweichen, eine **Tagesform** pro Kampf (±65 % Schaden) und seltene **Wuchttreffer** (30 % der gegnerischen Lebenspunkte).

Dazu kommen Kampfstil (Schwer, Flink, Speer), Haltung mit Konter-Dreieck (Aggressiv > Ausweichend > Defensiv > Aggressiv), Distanz und Letztes Gefecht unter 25 % HP.

## Das Test-Tool

- **Duell**: zwei Gladiatoren bauen (Stats, Stil, Anweisungen, Ausrüstung, Sockel, Steine). Kraft, Arena-Klasse und Formel-Chance werden sofort angezeigt. Ein Einzelkampf zeigt den HP-Verlauf und jedes Ereignis. Die Massensimulation rechnet zum Beispiel 10.000 Kämpfe und vergleicht sie mit der Formel. „Steinwert messen“ zeigt, was die Sondersteine von A wirklich bringen.
- **Analysen**: Formel gegen Simulation, Haltungs-Konter, Steine als Kraft-Aufschlag, Steine je Bauart (Glaskanone, Panzer usw.), Letztes Gefecht, passende Distanz, Siegquote am Klassenrand, Kampfstile. Jede Analyse zeigt, ob sie ihr Ziel erreicht.
- **Einstellungen**: Arena-Klassen (Grenzen, Einsätze), Exponent, Stein-Aufschläge und alle anderen Zahlen als JSON. Änderungen werden im Browser gespeichert, lassen sich exportieren, importieren und zurücksetzen.

Beträge stehen intern in Silber (100 Silber = 1 Gold).

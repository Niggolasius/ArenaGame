# ArenaGame

Browser-Prototyp eines Arena-Spiels: Gladiatoren kämpfen in Echtzeit-Autokämpfen, die man sich ansieht. Dieser Stand ist **Meilenstein 2**: Kampf-Simulation und Test-Tool (Meilenstein 1) plus der Pixel-Kampf im Kolosseum mit Mercy-Moment. Das Spiel selbst ist auf Englisch, alle Namen, die Spieler sehen, stehen in `src/sim/names.ts`.

## Starten

```bash
npm install
npm run dev        # Test-Tool im Browser
npm test           # automatische Tests
npm run build:single   # alles in EINE Datei: dist-single/index.html, im Browser öffnen, ohne npm
npm run balance    # alle Balance-Analysen in der Konsole
npm run balance -- stones --n 20000 --seed 3   # nur eine Analyse, mit mehr Kämpfen
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/sim/` | Die Simulation ohne Grafik: Typen, Zahlen (`config.ts`), Kampf (`combat.ts`), Stats und Kraft (`stats.ts`), Analysen (`analysis.ts`) |
| `src/render/` | Die Darstellung: Pixel-Kampf (`arena.ts`), Kolosseum (`stage.ts`), Choreografie aus den Kampf-Ereignissen (`timeline.ts`), Sprite-Sheets (`sprites.ts`), Platzhalter-Grafik (`placeholder.ts`), Klänge (`audio.ts`) |
| `src/tool/` | Das Test-Tool im Browser. Massensimulationen laufen in einem Web Worker. |
| `scripts/balance.ts` | Dieselben Analysen ohne Browser |
| `tests/` | Tests mit vitest |

Die Simulation ist deterministisch: gleiche Gladiatoren und gleicher Seed ergeben immer denselben Kampf. Der Kampf liefert eine Liste von Ereignissen, die `src/render/` als Pixel-Kampf abspielt. Die Grafik entscheidet nichts, sie zeigt nur, was die Simulation ausgerechnet hat.

## Wie ein Kampf funktioniert

Die Kraft eines Gladiators ist **K = √((ATK + SPD/2) × (DEF + HP))**, Sondersteine geben einen Aufschlag auf K. Die Siegchance sagt die Formel **P(A) = K_A⁴ / (K_A⁴ + K_B⁴)** voraus.

Die Simulation ist so gebaut, dass diese Formel im Mittel stimmt:

- Schaden pro Sekunde wächst mit ATK + SPD/2.
- Aushalten wächst mit DEF + HP.
- Zufall sorgt für Überraschungen: Streuung pro Treffer, Krits, Ausweichen, eine **Tagesform** („Form“) pro Kampf (±65 % Schaden) und seltene **Wuchttreffer** („Crushing Blow“, 30 % der gegnerischen Lebenspunkte).

Dazu kommen Kampfstil (Heavy, Swift, Spear), Haltung mit Konter-Dreieck (Aggressive > Evasive > Defensive > Aggressive), Distanz (Close, Range) und Letztes Gefecht („Last Stand“: All In oder Hold Out) unter 25 % HP.

## Das Test-Tool

- **Duell**: zwei Gladiatoren bauen (Stats, Stil, Anweisungen, Ausrüstung, Sockel, Steine). Kraft, Arena-Klasse und Formel-Chance werden sofort angezeigt. Ein Einzelkampf zeigt den HP-Verlauf und jedes Ereignis. Die Massensimulation rechnet zum Beispiel 10.000 Kämpfe und vergleicht sie mit der Formel. „Steinwert messen“ zeigt, was die Sondersteine von A wirklich bringen.
- **Analysen**: Formel gegen Simulation, Haltungs-Konter, Steine als Kraft-Aufschlag, Steine je Bauart (Glaskanone, Panzer usw.), Letztes Gefecht, passende Distanz, Siegquote am Klassenrand, Kampfstile. Jede Analyse zeigt, ob sie ihr Ziel erreicht.
- **Einstellungen**: Arena-Klassen (Grenzen, Einsätze), Exponent, Stein-Aufschläge und alle anderen Zahlen als JSON. Änderungen werden im Browser gespeichert, lassen sich exportieren, importieren und zurücksetzen.

Beträge stehen intern in Silber (100 Silber = 1 Gold).

## Der Pixel-Kampf (Tab „Arena“)

Zeigt den Kampf der beiden Gladiatoren aus dem Duell-Tab mit dem eingestellten Seed. Ablauf:

1. **Einmarsch** mit Einblendung der Tagesform („In Top Form! +40%“).
2. **Kampf** (~11 s): Angriffs-Animationen treffen genau zum Zeitpunkt der Simulation. Schadenszahlen, Krits (gelb, kurzer Stopp), Crushing Blow (orange, Bildschirmwackeln, Einfrieren, Blitz), Ausweichen, Heilung, Dornen, Last Stand.
3. **Mercy**: Der Verlierer kniet und bietet Geld. 10 s stimmt das Publikum ab (Köpfe werden grün oder rot). Dann entscheidet der Sieger: *Take the Gold*, *Spare with Honor* oder *Kill*.
4. **Finisher**: Heavy köpft, Swift sticht ins Herz, Spear spießt auf. Gold: Der Beutel wird geworfen. Ehrenvoll: aufhelfen und Arm hochreißen.
5. **Ergebnis**: Ruhm (± pro abstimmendem Zuschauer, je nachdem ob der Sieger der Mehrheit folgt), Gold, Ehre oder Schlächter, Narbe oder Tod mit Full Loot.

Schalter: Tempo ½×/1×/2×, „Skip“ spult bis zum nächsten Abschnitt, Blut an/aus, Ton an/aus. Die Zahlen des Mercy-Moments (Zuschauer pro Klasse, Bestechung, Ruhm pro Stimme, Narbe) stehen in den Einstellungen unter `mercy`.

### Eigene Grafik einbauen

Die Figuren sind Platzhalter. Jede Figur ist ein Sprite-Sheet, 32×32 pro Bild, eine Zeile pro Animation:

| Zeile | Animation | Pflicht |
| --- | --- | --- |
| 0 | idle (Stehen) | ja |
| 1 | walk (Laufen) | ja |
| 2 | attack (mit `hitFrame`: Bild, in dem die Waffe trifft) | ja |
| 3 | hit (getroffen) | ja |
| 4 | death (mit `kneelFrame`: Bild, in dem die Figur kniet) | ja |
| 5 | cheer (Arm hochreißen) | nein, sonst idle |
| 6 | help (Hand reichen) | nein, sonst idle |
| 7 | head (nur der Kopf, fliegt beim Köpfen) | nein, sonst fliegt nichts |
| 8 | deathHeadless (Tod ohne Kopf) | nein, sonst death |

1. PNG nach `public/sprites/` legen, zum Beispiel `public/sprites/heavy.png`.
2. In `src/render/sprites.ts` bei der Figur `src: 'sprites/heavy.png'` eintragen.
3. Zeilen, Bildzahl, fps und Fußpunkt (`anchorX`, `anchorY`) an das Sheet anpassen. Ein Asset-Pack muss nicht genau dieses Raster haben.

Im Tab „Arena“ lässt sich jedes Platzhalter-Sheet als PNG-Vorlage herunterladen. Die Figur im Sheet schaut nach rechts, die rechte Figur wird automatisch gespiegelt.

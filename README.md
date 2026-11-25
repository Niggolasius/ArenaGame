# ArenaGame

Browser-Prototyp eines Arena-Spiels: Gladiatoren kämpfen in Echtzeit-Autokämpfen, die man sich ansieht. Dieser Stand ist **Meilenstein 3**: Kampf-Simulation und Test-Tool (Meilenstein 1), Pixel-Kampf mit Mercy-Moment (Meilenstein 2) und dazu Insel mit Minen, Inventar und Postfach. Das Spiel selbst ist auf Englisch, alle Namen, die Spieler sehen, stehen in `src/sim/names.ts`.

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
| `src/sim/` | Die Simulation ohne Grafik: Typen, Zahlen (`config.ts`), Kampf (`combat.ts`), Stats und Kraft (`stats.ts`), Analysen (`analysis.ts`), Minen (`mine.ts`), Loot (`loot.ts`), Spielstand mit Postfach (`game.ts`) |
| `src/render/` | Die Darstellung: Mine mit Arbeiter (`mineScene.ts`), Pixel-Icons (`icons.ts`), Pixel-Kampf (`arena.ts`), Kolosseum (`stage.ts`), Choreografie aus den Kampf-Ereignissen (`timeline.ts`), Sprite-Sheets (`sprites.ts`), Platzhalter-Grafik (`placeholder.ts`), Klänge (`audio.ts`) |
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
2. **Kampf** (~11 s, etwa 2 Treffer pro Sekunde): Beinarbeit durch die Arena, Ausweich-Rollen, Kamera-Zoom bei Krits, Wuchttreffern und dem letzten Schlag, Herzschlag und roter Rand bei wenig HP. Angriffs-Animationen treffen genau zum Zeitpunkt der Simulation. Schadenszahlen, Krits (gelb, kurzer Stopp), Crushing Blow (orange, Bildschirmwackeln, Einfrieren, Blitz), Ausweichen, Heilung, Dornen, Last Stand.
3. **Mercy**: Der Verlierer kniet und bietet Geld. Bis zu 5 s stimmt das Publikum ab (Köpfe werden grün oder rot). Der Sieger kann jederzeit entscheiden: *Take the Gold*, *Spare with Honor* oder *Kill*. Wer früh entscheidet, bekommt Ruhm nur für die Stimmen bis dahin. Ohne Zuschauer (in den Einstellungen 0) stimmt ein kleines NPC-Publikum in 2 s ab.
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

## Insel, Inventar, Postfach (Meilenstein 3)

**Island**: Bauplätze für Minen-Karten (Common *Copper Pit*, Epic *Iron Mine*, Mythic *Obsidian Vein*, +50 % Menge). Der Arbeiter schlägt im Takt des Durchgangs (3 Schläge pro Durchgang, Aufprall genau auf dem `hitFrame`), am Ende fliegt ein Brocken in die Lore. Ladebalken: im Prototyp 5 s pro Durchgang. Jeder Durchgang landet im Lager (8 Plätze, die Lore füllt sich mit). Volles Lager: Stillstand ohne Verschleiß, der Arbeiter setzt sich und schläft. Nach `runs` Durchgängen ist die Karte verbraucht. **Collect** schickt das Lager als Brief ins Postfach. Die Minen laufen auch weiter, wenn ein anderer Tab offen oder der Browser zu war (bis 3 Tage werden nachgeholt). Test controls: Zeitraffer 1×/10×/60×, Karten hinzufügen, Lager füllen, Karte fast verbrauchen. Die Tabelle „Mine numbers“ rechnet die erwartete Ausbeute aus der Drop-Tabelle aus.

**Mailbox**: Reiter Fights, Mine, System, rote Zahl für Ungelesenes und noch nicht Abgeholtes. Ein Kampf-Brief heißt nur „Fight #1042 finished“, das Ergebnis kommt erst mit **Show result** oder **Watch replay** (gleicher Kampf, gleiche Entscheidung). Bonus-Loot wird einzeln aufgedeckt, das Seltenste zuletzt (davor zittert die Karte). Labels wie in PoE2: Common grün, Rare blau, Epic lila mit Beam, Legendary orange mit Beam, Blitz und Klang, Mythic weißer Kasten mit dunkelroter Schrift und weißem Beam. **Claim all** legt alles ins Inventar. Nichts verfällt.

**Kämpfe ins Postfach**: Jeder im Tab „Arena“ angesehene Kampf und jeder Kampf mit **Fight unseen** (blinde Arena, ×10 für Tests) erzeugt einen Brief. Spieler ist immer A. Der Einsatz ist sofort weg; beim Abholen kommen Pott (2 × Einsatz minus Arena-Anteil), Gnadengeld, Ruhm, Bonus-Steine nach Arena-Klasse und bei einem Kill die Ausrüstung des Gegners (Full Loot, 33 % werden zerstört, samt Steinen). Bei „Fight unseen“ folgt der Sieger der Mehrheit des Publikums. Das Test-Tool lässt Gold ins Minus gehen und tote Gladiatoren leben weiter, damit man weiter testen kann.

**Inventory**: Gold, Ruhm, Ehre, Schlächter, die beiden Gladiatoren aus dem Duell, Minen-Karten (platzieren), Ausrüstung mit Sockeln, Edelsteine und Rohstoffe als Stapel.

Alle Zahlen stehen unter Settings in `mine` (Durchgangsdauer, Lager, Laufzeit, Drop-Tabellen) und `loot` (Zerstör-Chance, Bonus-Loot pro Klasse). Der Arbeiter ist wie die Gladiatoren ein austauschbares Sprite-Sheet (`MINER` in `src/render/sprites.ts`: Zeile 0 Schlag, 1 Schlafen, 2 Stehen). Ein Pet statt Arbeiter geht genauso.

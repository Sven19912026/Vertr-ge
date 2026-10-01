# Vertragsmanager – Version 1

Statische Web-App für GitHub Pages, bewusst **ohne Firebase**.

## Enthalten
- Dashboard mit Fristen und Warnungen
- Dienstleister als zentrale Ebene
- Verträge pro Dienstleister
- frei verwaltbare Kategorien
- Benutzerrollen: Admin / Bearbeiter / Leser
- Notizen auf Dienstleister- und Vertragsebene
- Kündigungsvorgänge inkl. durch wen / wann / Art / gewünschtes Ende / Bestätigung
- letzte 10 Kündigungen im Dashboard
- lokale Dokumentablage in IndexedDB (Vertrag, Nachtrag, Kündigungsschreiben, Bestätigung usw.)
- Audit-/Verlauf je Vertrag
- JSON Export / Import für spätere Migration
- responsive Oberfläche für PC und Smartphone

## Wichtig
Die App speichert alle Daten nur im jeweiligen Browser (IndexedDB). Dadurch können Benutzer auf unterschiedlichen Geräten **noch nicht dieselben Daten sehen**. Das ist absichtlich so, bis die spätere Dashwise-Cloud/API angebunden wird.

## GitHub Pages
1. `index.html`, `styles.css` und `app.js` in das Repository legen.
2. GitHub Pages für den Branch aktivieren.
3. Seite öffnen.

Es ist kein Build-Schritt erforderlich.

## Späterer Dashwise-Umzug
Die Datenspeicherung ist im JavaScript über die Klasse `IndexedDbStorage` gekapselt. Für die Cloud-Version kann diese Schicht durch einen Dashwise-API-Adapter ersetzt werden, ohne die komplette Oberfläche neu zu schreiben.

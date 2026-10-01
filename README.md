# Vertragsmanager – Version 2

GitHub-Pages-fähige Vertragsverwaltung ohne Firebase.

## Neu in Version 2

- modernes Dark-Mode-Design
- Mail-Erinnerung pro Vertrag aktivierbar
- frei einstellbarer Erinnerungsvorlauf in Tagen
- eigener Mail-Empfänger pro Vertrag
- alternativ Empfänger aus der E-Mail-Adresse des verantwortlichen Users
- Test-Mail über das lokale Mailprogramm / Outlook via `mailto:`
- Dashboard zeigt Fristen, Mailstatus und fehlende Empfänger
- vorbereitet für automatischen Mailversand über Dashwise/Backend

## Wichtig zum automatischen Mailversand

Eine reine GitHub-Pages-Webseite läuft nur, wenn sie im Browser geöffnet ist. Sie kann daher nicht zuverlässig jeden Tag im Hintergrund prüfen und selbstständig Outlook-Mails versenden.

Für den späteren Produktivbetrieb sollte Dashwise bzw. ein Backend täglich:

1. aktive Verträge und deren Kündigungsfrist prüfen,
2. den hinterlegten Erinnerungsvorlauf berücksichtigen,
3. den Mail-Empfänger des Vertrags oder des Verantwortlichen bestimmen,
4. die Erinnerungsmail über Microsoft 365 / Outlook versenden,
5. Versanddatum und Ergebnis protokollieren.

Die benötigten Felder sind in Version 2 bereits im Vertragsdatensatz vorgesehen.

## Lokale Speicherung

Aktuell werden Daten mit IndexedDB lokal im Browser gespeichert. Es gibt keine Firebase-Verbindung.

Wenn Version 2 unter derselben GitHub-Pages-Adresse wie Version 1 eingespielt wird, bleibt dieselbe IndexedDB-Datenbank bestehen. Vor einem Update empfiehlt sich trotzdem ein JSON-Export über `Daten & Export`.

## GitHub Pages

Die Dateien müssen direkt im Root des Repositorys liegen:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`

GitHub: Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

# Supplier Hub V4

GitHub-Pages-faehige lokale Vorstufe fuer Lieferanten, Vertraege und Verhandlungen. Keine Firebase-Abhaengigkeit.

## Neu in V4: automatische Abschlussmail nach Verhandlung

Bei jeder Verhandlung koennen hinterlegt werden:

- zustaendiger Bauleiter (optional aus den vorhandenen Benutzern)
- Bauleiter-Name
- Outlook-/E-Mail-Adresse
- Ausgangspreis, aktueller Preis und Zielpreis
- Zusammenfassung / Verhandlungsergebnis
- Auftragsbestaetigung (AB) als Datei

Wenn der Status erstmals auf **Abgeschlossen** gesetzt wird:

1. Das Verhandlungsstadium wird auf **Abgeschlossen** gesetzt.
2. Der aktuelle Preis wird als Endpreis verwendet.
3. Die Bauleiter-E-Mail wird geprueft. Ohne E-Mail kann die Verhandlung nicht abgeschlossen werden.
4. Eine Abschlussmail wird automatisch erzeugt.
5. Eine hinterlegte AB wird der Mail als vorgesehener Anhang zugeordnet.
6. Die Mail wird in `mailQueue` mit Status `pending` gespeichert.
7. Der Vorgang wird im Audit-Verlauf dokumentiert.

Wird nachtraeglich eine neue AB hochgeladen, aktualisiert die App die vorgemerkte Abschlussmail automatisch.

## E-Mail-Inhalt

Die Abschlussmail enthaelt u. a.:

- Verhandlungsgegenstand
- Lieferant
- Gesellschaft
- Ausgangspreis netto
- Endpreis netto
- Zielpreis netto
- Preisverbesserung
- Menge / Volumen
- Ansprechpartner beim Lieferanten
- verantwortlichen Verhandler
- Zusammenfassung / Verhandlungsergebnis
- Hinweis auf die AB im Anhang

## Wichtiger technischer Punkt

GitHub Pages ist eine statische Webseite. Ein zuverlaessiger vollautomatischer Outlook-Versand mit Anhang darf nicht mit geheimen Microsoft-Zugangsdaten im Browser umgesetzt werden.

Darum ist V4 bereits so aufgebaut, dass der Abschluss-Trigger und die Versandwarteschlange automatisch funktionieren. Beim spaeteren Umzug auf Dashwise muss der Server nur noch die `mailQueue` verarbeiten.

Empfohlener Server-Ablauf:

1. Dashwise erkennt einen neuen `pending`-Eintrag.
2. Der Server laedt die zugeordnete AB aus dem Cloud-Speicher.
3. Versand ueber Microsoft Graph / Microsoft 365.
4. Bei Erfolg: `status = sent`, `sentAt = ...`.
5. Bei Fehler: Retry und Fehlerprotokoll.

Microsoft-Client-Secrets oder Graph-Zugangsdaten gehoeren ausschliesslich auf den Server und nicht in `app.js` oder GitHub Pages.

## Dateien

- `index.html`
- `styles.css`
- `app.js`
- `README.md`

## GitHub Pages

Alle Dateien in das Hauptverzeichnis des Repositories hochladen und Pages ueber `main` / `/ (root)` veroeffentlichen.

## Speicher

Derzeit IndexedDB im Browser. Bestehende V3-Daten bleiben durch das Datenbank-Upgrade erhalten. V4 legt zusaetzlich den Store `mailQueue` an.

// Eigene Explorer-Anbindung statt der fremden Erweiterung "Local Explorer".
//
// Erzeugt zwei Dateien zum Herunterladen:
//   open-folder.vbs      – nimmt eine stldl:-Adresse entgegen, öffnet den Ordner
//   stldl-protokoll.reg  – meldet das Schema bei Windows an
//
// Warum VBScript und nicht .cmd: Eine Batch-Datei lässt beim Start kurz ein
// Konsolenfenster aufblitzen. Über wscript.exe läuft das Skript unsichtbar.
// Nachteil: Microsoft hat VBScript abgekündigt, es verschwindet irgendwann
// aus Windows. Solange es da ist, ist es der unauffälligste Weg ohne eigene
// kompilierte Datei.
//
// Der Ablageort ist fest: %LOCALAPPDATA%\STLModelDownloader\. Dadurch kommt
// die .reg-Datei ohne Benutzernamen aus und funktioniert auf jedem Rechner.
//
// Das Skript ist zeilenweise zusammengesetzt statt als ein langer Text: So
// bleibt eindeutig, wo ein Backslash hingehört, ohne dreifaches Maskieren.
//
// Das Skript kann drei Dinge:
//   ohne Parameter                – sich selbst einrichten (Doppelklick)
//   stldl:<Pfad>                  – Ordner im Explorer öffnen
//   stldl:?einrichten|<Kennung>|… – den eigenen Pfad an die Erweiterung melden
//
// Das Einrichten per Doppelklick spart die früheren Handgriffe: Der Nutzer
// musste den Ablageordner selbst anlegen und die Datei hineinziehen. Jetzt
// legt das Skript den Ordner an, kopiert sich hinein, öffnet die daneben
// liegende .reg-Datei und fragt nach dem Zielordner. Das Eintragen in die
// Registrierung überlässt es dabei Windows - mit dessen eigener Rückfrage.

// Die Kommentare der heruntergeladenen Dateien stehen in den Sprachdateien.
// Wer eine .reg-Datei vor dem Doppelklick aufmacht - zu Recht, sie traegt
// etwas in die Registrierung ein -, soll dort lesen koennen, was passiert.
// Gibt die Zeilen eines Textes als Kommentarzeilen zurueck: jede Zeile mit
// dem Kommentarzeichen davor, leere Zeilen nur mit dem Zeichen.
function kommentar(schluessel, einzug = '', zeichen = "'") {
  return chrome.i18n.getMessage(schluessel).split('\n')
    .map(zeile => einzug + (zeile ? zeichen + ' ' + zeile : zeichen));
}

const STLDL_ORDNER = '%LOCALAPPDATA%\\STLModelDownloader';
const STLDL_SKRIPT = 'open-folder.vbs';
const STLDL_REG = 'stldl-protokoll.reg';

// Texte, die das Skript selbst in Dialogfenstern zeigt. Sie werden beim
// Erzeugen eingesetzt, nicht beim Aufruf - ein doppelgeklicktes Skript
// bekommt ja keine Adresse, aus der es sie lesen könnte.
function vbsText(schluessel) {
  // VBScript kennt keine mehrzeiligen Zeichenketten: Ein Zeilenumbruch im
  // Text muss als vbCrLf zwischen zwei Teilstuecken stehen, sonst bricht
  // die Datei beim ersten Absatz ab.
  return chrome.i18n.getMessage(schluessel)
    .replace(/"/g, '""')
    .split('\n')
    .map((teil) => '"' + teil + '"')
    .join(' & vbCrLf & ');
}

const VBS_INHALT = [
  ...kommentar('vbsHeader'),
  "",
  ...kommentar('vbsVersion'),
  'Const FASSUNG = "' + EXP_SKRIPT_VERSION + '"',
  "",
  ...kommentar('vbsFiles'),
  'Const DATEI_OK = "' + EXP_LEBENSZEICHEN + '"',
  'Const DATEI_FRAGE = "' + EXP_FRAGE + '"',
  'Const DATEI_ANTWORT = "' + EXP_ANTWORT + '"',
  'Const DATEI_ZIEL = "' + EXP_ZIELDATEI + '"',
  "",
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'logDatei = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "open-folder.log")',
  "",
  "Sub Protokoll(text)",
  "  On Error Resume Next",
  "  Dim f",
  "  Set f = fso.OpenTextFile(logDatei, 8, True)",
  '  f.WriteLine Now & "  " & text',
  "  f.Close",
  "End Sub",
  "",
  ...kommentar('vbsUtf8'),
  "Function Utf8ZuText(bytes, anzahl)",
  "  Dim i, b1, code, ergebnis",
  '  ergebnis = ""',
  "  i = 0",
  "  Do While i < anzahl",
  "    b1 = bytes(i)",
  "    If b1 < &H80 Then",
  "      ergebnis = ergebnis & ChrW(b1)",
  "      i = i + 1",
  "    ElseIf b1 >= &HC0 And b1 < &HE0 And i + 1 < anzahl Then",
  "      code = ((b1 And &H1F) * 64) + (bytes(i + 1) And &H3F)",
  "      ergebnis = ergebnis & ChrW(code)",
  "      i = i + 2",
  "    ElseIf b1 >= &HE0 And i + 2 < anzahl Then",
  "      code = ((b1 And &HF) * 4096) + ((bytes(i + 1) And &H3F) * 64) + (bytes(i + 2) And &H3F)",
  "      ergebnis = ergebnis & ChrW(code)",
  "      i = i + 3",
  "    Else",
  "      ergebnis = ergebnis & ChrW(b1)",
  "      i = i + 1",
  "    End If",
  "  Loop",
  "  Utf8ZuText = ergebnis",
  "End Function",
  "",
  ...kommentar('vbsUrlDecode'),
  "Function UrlDecode(wert)",
  "  Dim i, zeichen, bytes, anzahl",
  "  ReDim bytes(Len(wert) + 1)",
  "  anzahl = 0",
  "  i = 1",
  "  Do While i <= Len(wert)",
  "    zeichen = Mid(wert, i, 1)",
  '    If zeichen = "%" And i + 2 <= Len(wert) Then',
  '      bytes(anzahl) = CLng("&H" & Mid(wert, i + 1, 2))',
  "      i = i + 3",
  "    Else",
  "      bytes(anzahl) = AscW(zeichen) And &HFF",
  "      i = i + 1",
  "    End If",
  "    anzahl = anzahl + 1",
  "  Loop",
  "  UrlDecode = Utf8ZuText(bytes, anzahl)",
  "End Function",
  "",
  ...kommentar('vbsReadFile'),
  "Function DateiLesen(pfad)",
  "  Dim f",
  '  DateiLesen = ""',
  "  If Not fso.FileExists(pfad) Then Exit Function",
  "  On Error Resume Next",
  "  Set f = fso.OpenTextFile(pfad, 1)",
  "  DateiLesen = Trim(f.ReadAll)",
  "  f.Close",
  "  On Error GoTo 0",
  "End Function",
  "",
  ...kommentar('vbsTargetStore'),
  "Function AblageDatei()",
  '  AblageDatei = fso.BuildPath(CreateObject("WScript.Shell")' +
    '.ExpandEnvironmentStrings("' + STLDL_ORDNER + '"), DATEI_ZIEL)',
  "End Function",
  "",
  "Sub ZielMerken(pfad)",
  "  Dim ordner, f",
  "  On Error Resume Next",
  '  ordner = CreateObject("WScript.Shell").ExpandEnvironmentStrings("' + STLDL_ORDNER + '")',
  "  If Not fso.FolderExists(ordner) Then fso.CreateFolder ordner",
  "  Set f = fso.CreateTextFile(AblageDatei(), True, True)",
  "  f.Write pfad",
  "  f.Close",
  "  On Error GoTo 0",
  "End Sub",
  "",
  "Function UnicodeLesen(pfad)",
  "  Dim f",
  '  UnicodeLesen = ""',
  "  If Not fso.FileExists(pfad) Then Exit Function",
  "  On Error Resume Next",
  "  Set f = fso.OpenTextFile(pfad, 1, False, -1)",
  "  UnicodeLesen = Trim(f.ReadAll)",
  "  f.Close",
  "  On Error GoTo 0",
  "End Function",
  "",
  "Function Vergleichbar(pfad)",
  "  Dim p",
  "  p = LCase(Trim(pfad))",
  '  Do While Len(p) > 3 And Right(p, 1) = "\\"',
  "    p = Left(p, Len(p) - 1)",
  "  Loop",
  "  Vergleichbar = p",
  "End Function",
  "",
  ...kommentar('vbsGuard'),
  "Function IstEigenerOrdner(pfad)",
  "  Dim basis, p",
  "  IstEigenerOrdner = False",
  "  basis = Vergleichbar(UnicodeLesen(AblageDatei()))",
  '  If basis = "" Then Exit Function',
  "  p = Vergleichbar(pfad)",
  '  If InStr(p, "..") > 0 Then Exit Function',
  "  If p = basis Then",
  "    IstEigenerOrdner = True",
  '  ElseIf Left(p, Len(basis) + 1) = basis & "\\" Then',
  "    IstEigenerOrdner = True",
  "  End If",
  "End Function",
  "",
  ...kommentar('vbsSetup'),
  "Function OrdnerFragen(kennung)",
  "  Dim shell, auswahl, pfad, gefunden, f, titel, fehler",
  "  OrdnerFragen = False",
  '  titel = ' + vbsText('expAssignDialogTitle'),
  '  fehler = ' + vbsText('expAssignDialogError'),
  "",
  '  Set shell = CreateObject("Shell.Application")',
  ...kommentar('vbsFolderFlags', '  '),
  "  Set auswahl = shell.BrowseForFolder(0, titel, &H1, 17)",
  "  If auswahl Is Nothing Then",
  '    Protokoll "Ordnerauswahl abgebrochen."',
  "    Exit Function",
  "  End If",
  "  pfad = auswahl.Self.Path",
  "",
  ...kommentar('vbsMarker', '  '),
  "  gefunden = DateiLesen(fso.BuildPath(pfad, DATEI_FRAGE))",
  '  If gefunden = "" Or (kennung <> "" And gefunden <> kennung) Then',
  '    Protokoll "Falscher Ordner gewaehlt - " & pfad',
  "    MsgBox fehler, 48, titel",
  "    Exit Function",
  "  End If",
  "",
  ...kommentar('vbsUnicode', '  '),
  "  On Error Resume Next",
  "  Set f = fso.CreateTextFile(fso.BuildPath(pfad, DATEI_ANTWORT), True, True)",
  "  f.WriteLine FASSUNG",
  "  f.Write pfad",
  "  f.Close",
  "  On Error GoTo 0",
  "",
  "  ZielMerken pfad",
  "  OrdnerFragen = True",
  "End Function",
  "",
  "Sub Einrichten(felder)",
  "  Dim kennung",
  '  kennung = ""',
  "  If UBound(felder) >= 1 Then kennung = Trim(felder(1))",
  '  If kennung = "" Then',
  '    Protokoll "Einrichten ohne Kennung aufgerufen."',
  "    Exit Sub",
  "  End If",
  "  OrdnerFragen kennung",
  "End Sub",
  "",
  ...kommentar('vbsInstall'),
  "Sub SelbstEinrichten()",
  "  Dim shell, ablage, ziel, regDatei, antwort",
  '  Set shell = CreateObject("WScript.Shell")',
  '  ablage = shell.ExpandEnvironmentStrings("' + STLDL_ORDNER + '")',
  '  ziel = fso.BuildPath(ablage, "' + STLDL_SKRIPT + '")',
  '  regDatei = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "' + STLDL_REG + '")',
  "",
  ...kommentar('vbsAskFirst', '  '),
  "  antwort = MsgBox(" + vbsText('vbsAskText') + " & vbCrLf & vbCrLf & ablage, _",
  "    vbYesNo + vbQuestion, " + vbsText('vbsAskTitle') + ")",
  "  If antwort <> vbYes Then",
  '    Protokoll "Einrichtung abgelehnt."',
  "    Exit Sub",
  "  End If",
  "",
  "  On Error Resume Next",
  "  If Not fso.FolderExists(ablage) Then fso.CreateFolder ablage",
  "  If LCase(WScript.ScriptFullName) <> LCase(ziel) Then",
  "    fso.CopyFile WScript.ScriptFullName, ziel, True",
  "  End If",
  "  If Err.Number <> 0 Then",
  '    MsgBox ' + vbsText('vbsCopyFailed') + ' & vbCrLf & vbCrLf & Err.Description, 16, ' + vbsText('vbsAskTitle'),
  "    Exit Sub",
  "  End If",
  "  On Error GoTo 0",
  "",
  ...kommentar('vbsRegStep', '  '),
  "  If fso.FileExists(regDatei) Then",
  "    shell.Run Chr(34) & regDatei & Chr(34), 1, True",
  "  Else",
  '    Protokoll "Registrierungsdatei nicht gefunden: " & regDatei',
  "    MsgBox " + vbsText('vbsRegMissing') + ", 48, " + vbsText('vbsAskTitle'),
  "  End If",
  "",
  ...kommentar('vbsFolderStep', '  '),
  '  If OrdnerFragen("") Then',
  "    MsgBox " + vbsText('vbsDoneText') + ", 64, " + vbsText('vbsAskTitle'),
  "  Else",
  "    MsgBox " + vbsText('vbsDoneNoFolder') + ", 64, " + vbsText('vbsAskTitle'),
  "  End If",
  "End Sub",
  "",
  ...kommentar('vbsMain'),
  "",
  "If WScript.Arguments.Count = 0 Then",
  "  SelbstEinrichten",
  "  WScript.Quit",
  "End If",
  "",
  "roh = WScript.Arguments(0)",
  "rest = roh",
  "",
  ...kommentar('vbsScheme'),
  'If InStr(1, rest, "stldl:", 1) = 1 Then rest = Mid(rest, 7)',
  'Do While Left(rest, 1) = "/" Or Left(rest, 1) = "\\"',
  "  rest = Mid(rest, 2)",
  "Loop",
  "",
  "rest = UrlDecode(rest)",
  "",
  ...kommentar('vbsTask'),
  'If Left(rest, 1) = "?" Then',
  '  felder = Split(Mid(rest, 2), "|")',
  '  If felder(0) = "einrichten" Then',
  "    Einrichten felder",
  "  Else",
  '    Protokoll "Unbekannter Auftrag: " & rest',
  "  End If",
  "  WScript.Quit",
  "End If",
  "",
  'pfad = Replace(rest, "/", "\\")',
  "",
  ...kommentar('vbsTrailingSlash'),
  'Do While Len(pfad) > 3 And Right(pfad, 1) = "\\"',
  "  pfad = Left(pfad, Len(pfad) - 1)",
  "Loop",
  "",
  "If Not IstEigenerOrdner(pfad) Then",
  '  Protokoll "Abgelehnt - nicht der zugeordnete Zielordner." & vbCrLf & "  empfangen: " & roh',
  "  WScript.Quit",
  "End If",
  "",
  ...kommentar('vbsSafety'),
  "If Not fso.FolderExists(pfad) Then",
  '  Protokoll "Ordner nicht gefunden." & vbCrLf & "  empfangen:   " & roh & vbCrLf & "  ausgewertet: " & pfad',
  "  WScript.Quit",
  "End If",
  "",
  ...kommentar('vbsHeartbeat'),
  "On Error Resume Next",
  "Set lebenszeichen = fso.CreateTextFile(fso.BuildPath(pfad, DATEI_OK), True)",
  "lebenszeichen.WriteLine FASSUNG",
  "lebenszeichen.WriteLine Now",
  "lebenszeichen.Close",
  "On Error GoTo 0",
  "",
  'CreateObject("WScript.Shell").Run "explorer.exe " & Chr(34) & pfad & Chr(34), 1, False',
  ""
].join('\r\n');

// Der Befehl muss %LOCALAPPDATA% auflösen – dafür braucht die Registry den
// Typ REG_EXPAND_SZ, und der steht in .reg-Dateien als hex(2) mit der
// Zeichenkette in UTF-16.
function alsHex2(text) {
  const bytes = [];
  for (const zeichen of text + '\0') {
    const code = zeichen.charCodeAt(0);
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  const hex = bytes.map(b => b.toString(16).padStart(2, '0'));
  const zeilen = [];
  for (let i = 0; i < hex.length; i += 20) zeilen.push(hex.slice(i, i + 20).join(','));
  return zeilen.join(',\\\r\n  ');
}

function regInhalt() {
  const befehl = 'wscript.exe "' + STLDL_ORDNER + '\\' + STLDL_SKRIPT + '" "%1"';
  return [
    'Windows Registry Editor Version 5.00',
    '',
    ...kommentar('regRegister', '', ';'),
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\stldl]',
    '@="URL:3D Model Downloader & Organizer"',
    '"URL Protocol"=""',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\stldl\\shell\\open\\command]',
    '',
    // Der Hex-Block ist die unleserlichste Stelle der ganzen Einrichtung.
    // Wer eine Datei ausführt, die etwas in seine Registrierung schreibt,
    // soll lesen können, was darin steht - also steht es darüber.
    ...kommentar('regPlain', '', ';'),
    ';',
    ';   ' + befehl,
    ';',
    ...kommentar('regPlainHex', '', ';'),
    '',
    '@=hex(2):' + alsHex2(befehl),
    '',
    ...kommentar('regUndoHint', '', ';'),
    ''
  ].join('\r\n');
}

// Gegenstueck zum Einrichten: Das Minuszeichen vor dem Schluesselnamen weist
// den Registrierungs-Editor an, ihn samt Unterschluesseln zu loeschen.
function regEntfernenInhalt() {
  return [
    'Windows Registry Editor Version 5.00',
    '',
    ...kommentar('regUndo', '', ';'),
    '',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\stldl]',
    ''
  ].join('\r\n');
}

// VBScript und der Registrierungs-Editor erwarten ANSI oder UTF-16. Als UTF-8
// abgelegt kaemen Umlaute verstuemmelt an, deshalb schreiben wir beide Dateien
// in UTF-16 mit Byte-Reihenfolge-Marke.
function alsUtf16(text) {
  const bytes = [0xff, 0xfe];
  for (const zeichen of text) {
    const code = zeichen.charCodeAt(0);
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  return new Uint8Array(bytes);
}

function dateiHerunterladen(name, inhalt) {
  const daten = /\.(vbs|reg)$/i.test(name) ? alsUtf16(inhalt) : inhalt;
  const blob = new Blob([daten], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

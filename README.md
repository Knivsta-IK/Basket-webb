# Basketverkstan · Knivsta IK

En enkel gemensam skrivyta för föreningens dokument, övningar och träningspass. Materialet läses och sparas direkt i det privata repot `Knivsta-IK/Basket`. Det här publika repot innehåller bara webbgränssnittet.

## Använd sidan

Öppna webbplatsen och ange en personlig GitHub-token. Den behöver endast tillgång till `Knivsta-IK/Basket`, med **Contents: Read and write**. Kontoägaren måste redan ha rätt att skriva i det privata repot. En stegvis guide finns vid inloggningen. Detta är tokenbaserad åtkomst, inte ett separat gemensamt lösenord.

Token och material hålls i minnet, aldrig i localStorage, sessionStorage, URL:er eller loggar. När du loggar ut rensas arbetsytan. Sidans källkod är publik; det privata materialet hämtas bara efter autentisering direkt från GitHub. Ange aldrig token i källkoden. Förlorade eller utgångna token ersätts via GitHub.

- Filträd till vänster; en gemensam läs- och skrivyta till höger.
- Rubriker, fetstil, kursiv, understrykning, länkar, listor och inklistrade bilder.
- Ctrl+Z ångrar och Ctrl+Y gör om. Ctrl+Shift+Z fungerar också.
- Kopiering inom samma dokument bevarar formatering via en intern minnescache. Till andra dokument klistras bara text in. Cachen försvinner vid utloggning eller omladdning.
- Varje sparning kräver en beskrivning som blir ett GitHub-commit-meddelande.
- En fil med sina nya bilder, eller en uppladdning av flera filer, sparas i en enda commit.
- Ändringar i olika filer och oberoende textändringar slås ihop. Överlappande ändringar kräver ett manuellt beslut. Ingen force-push används.
- Träningspass sätts ihop av 4–6 sparade övningar, med ordning, tider och anteckningar. Pass kan sparas i repot eller laddas ner som Markdown.

## Materialets struktur

```text
ovningar/     Markdown-filer för övningar, valfria undermappar
traningar/    Sparade träningspass
bilder/       Inklistrade och infogade bilder
bilagor/      Filer som släppts eller klistrats in i texten
dokument/     Övrigt föreningsmaterial
```

Bilder sparas med relativa länkar. Externa bilder laddas inte automatiskt, för att undvika att dela besöksinformation med okända bildservrar. Välj PNG, JPG, WebP eller GIF. Filer får vara högst 5 MB; högst 200 filer och 50 MB totalt per uppladdning. Filer och mappar kan släppas i filträdet. Filer som operativsystemet exponerar via urklipp kan klistras in där med Ctrl+V. En mappväljare finns som alternativ till att dra mappar. Tomma mappar och dolda filer stöds inte.

Arbetsutkast och osparade träningspass finns bara i minnet. Spara innan sidan stängs. Sidans inbyggda påminnelse varnar när det finns osparat arbete. Flera personer kan arbeta samtidigt; det finns ingen realtidssynkronisering.

## Utveckling och publicering

```sh
npm ci
npm run dev
npm test
npm run test:browser # kräver Google Chrome och en lokal devserver på port 43851
npm run build
```

GitHub Actions bygger och publicerar `dist/` till GitHub Pages vid push till `main`. Relativa tillgångssökvägar gör att sidan fungerar under ett projekts GitHub-adress och senare med egen domän.

Nedladdningsknappar i filträdet hämtar enstaka filer eller mappar som ZIP. Direkt kopiering av faktiska filer till operativsystemets Utforskare stöds inte av webbgränssnittet.

## Mobil, tema och dokumentformat

Sidan följer enhetens ljusa eller mörka tema automatiskt. På telefon fälls biblioteket ihop efter ett filval och öppnas med **Visa filer**. Textfärg väljs ur en liten palett; färg och understrykning lagras som HTML-inslag i Markdown.

Word-import sker lokalt med Mammoth för `.docx`. Originalfilen sparas tillsammans med en Markdown-kopia och eventuella bilder. Vanliga rubriker, textmarkeringar, listor, länkar och tabeller följer med; sidlayout och avancerade Word-funktioner kan förenklas. Äldre `.doc` behöver först sparas som `.docx`.

CSV öppnas som en redigerbar tabell med Papa Parse. Excel `.xlsx` öppnas med ExcelJS och kan växla mellan arbetsbokens blad. Piltangenter och Enter flyttar mellan celler, Shift + pilar eller drag markerar områden, Delete tömmer dem, och Ctrl+C/V kopierar och klistrar in cellområden. Ctrl+Z/Y ångrar och gör om ändringar. Dubbelklick eller F2 börjar redigera en cell. Gränsen är 2 000 rader och 100 kolumner per blad. CSV-avgränsare och radslut bevaras. Excel-formler beräknas när arbetsboken öppnas i Excel; webbsidan kör inte formler. Komplexa Excel-arbetsböcker kan innehålla funktioner som ExcelJS inte bevarar fullt ut.

Word- och Excel-biblioteken laddas först när de används. Konvertering och redigering sker i webbläsaren, utan någon egen server.

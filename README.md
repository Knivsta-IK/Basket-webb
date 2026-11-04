# Material · Knivsta IK

En enkel gemensam skrivyta för föreningens dokument, övningar och träningspass. Materialet läses och sparas direkt i det privata repot `Knivsta-IK/Basket`. Det här publika repot innehåller bara webbgränssnittet.

## Använd sidan

Öppna webbplatsen, skriv ditt namn och det gemensamma lösenordet. Lösenordet låser upp en krypterad repo-begränsad åtkomstnyckel lokalt i webbläsaren. Produktens sidor visar inga instruktioner om den underliggande lagringen.

Åtkomstnyckeln hålls i minnet under sessionen, aldrig i localStorage, sessionStorage, URL:er eller loggar. Lösenordet sparas inte av appen. Utloggning rensar arbetsytan. Varje sparning får det angivna namnet som author och committer, med en syntetisk adress under den reserverade domänen `material.invalid`. Namn är själv angivna och utgör inte verifierade identiteter. Alla med det delade lösenordet har samma läs- och skrivrättigheter; bakomliggande åtkomst och revisionslogg tillhör nyckelns ägare.

## Aktivera lösenordet

Skapa en **fine-grained GitHub-token** med resource owner **Knivsta-IK**, endast repot **Basket**, och **Contents: Read and write**. Använd inte en bred administratörstoken. Välj giltighetstid och godkänn eventuell väntande organisationsförfrågan.

Kör lokalt i detta repo:

```sh
npm run configure-access -- --publish
```

Skriv nyckeln och en unik lösenfras med minst 16 tecken i terminalens dolda inmatning. Längre, slumpmässiga lösenfraser rekommenderas eftersom den publika krypterade filen kan utsättas för lösenordsgissning offline. Kommandot verifierar att materialet går att öppna, och skriver endast `public/access.json`: AES-256-GCM med slumpmässig 96-bitars IV, 256-bitars salt, PBKDF2-SHA256 med 600 000 iterationer och versionsbunden authenticated data. Varken lösenord eller okrypterad nyckel skrivs till disk. `--publish` committar endast den krypterade konfigurationen och pushar för publicering. Utan flaggan skapas filen lokalt.

Utan konfiguration går inget lösenord att använda. Vid utgången nyckel konfigureras en ny. När ett lösenord eller en nyckel behöver återkallas måste den gamla nyckeln återkallas i GitHub; tidigare publicerad krypterad data kan finnas kvar i historiken. Lösenordsbyte utan nyckelrotation återkallar inte någon som redan låst upp den gamla nyckeln. Webbläsarbaserad kryptering döljer inte nyckeln för en person som känner lösenordet och undersöker sin egen session.

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

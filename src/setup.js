import { sealAccess } from './access.js';
import './style.css';
const app = document.querySelector('#app');
app.innerHTML = `<div class="login-page"><header class="login-brand"><span>KNIVSTA IK <b>Material</b></span></header><main class="login-card setup-card"><span class="eyebrow">FÖR DIG SOM ANSVARAR FÖR MATERIALET</span><h1>Ställ in tillgång.</h1><p>Välj lösenordet som du vill dela med föreningen. Nyckeln krypteras här på din enhet.</p><form id="setup-form"><label for="setup-token">Åtkomstnyckel</label><input id="setup-token" type="password" autocomplete="off" spellcheck="false" placeholder="Klistra in den nya nyckeln" required><label for="setup-password">Välj lösenord</label><input id="setup-password" type="password" autocomplete="new-password" minlength="16" placeholder="Minst 16 tecken, gärna flera slumpade ord" required><label for="setup-repeat">Skriv lösenordet igen</label><input id="setup-repeat" type="password" autocomplete="new-password" minlength="16" required><p class="muted">Alla som får lösenordet kan läsa och ändra materialet. Använd en lång, unik lösenfras.</p><button class="primary" type="submit">Skapa krypterad inställning <span>→</span></button><p id="setup-error" class="form-error" role="alert"></p></form><section id="setup-result" hidden><h2>Klart på din enhet.</h2><p>Kopiera den krypterade inställningen och klistra in den i chatten med din assistent. Dela bara texten nedan, aldrig nyckeln eller lösenordet.</p><label for="encrypted-result">Krypterad inställning</label><textarea id="encrypted-result" readonly rows="5" spellcheck="false"></textarea><button id="copy-settings" class="primary">Kopiera krypterad inställning</button><p id="copy-status" class="muted" role="status"></p><p class="muted">Spara lösenordet på en trygg plats. Det går inte att läsa ut det ur inställningen. När inställningen har aktiverats kan du dela lösenordet med dem som ska ha tillgång.</p></section></main><footer>Nyckel och lösenord ingår inte i den text du kopierar.</footer></div>`;
const $ = selector => document.querySelector(selector);
$('#setup-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  let token = $('#setup-token').value.trim(), password = $('#setup-password').value;
  $('#setup-error').textContent = '';
  if (!token.startsWith('github_pat_')) { $('#setup-error').textContent = 'Använd den nya, begränsade nyckeln för materialet. En vanlig administratörsnyckel stöds inte.'; return; }
  if (password !== $('#setup-repeat').value) { $('#setup-error').textContent = 'Lösenorden är olika. Skriv samma lösenord i båda fälten.'; return; }
  button.disabled = true; button.textContent = 'Kontrollerar och krypterar…';
  try {
    const response = await fetch('https://api.github.com/repos/Knivsta-IK/Basket', { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Nyckeln kan inte öppna materialet. Kontrollera att den har rätt tillgång och är godkänd.');
    const repo = await response.json();
    if (repo.full_name !== 'Knivsta-IK/Basket' || !repo.private) throw new Error('Nyckeln pekar inte på rätt material.');
    const envelope = await sealAccess(token, password);
    token = null; password = null;
    $('#setup-token').value = ''; $('#setup-password').value = ''; $('#setup-repeat').value = '';
    $('#encrypted-result').value = JSON.stringify(envelope);
    $('#setup-form').hidden = true; $('#setup-result').hidden = false;
    $('#setup-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('#setup-error').textContent = error.message; }
  finally { token = null; password = null; button.disabled = false; button.textContent = 'Skapa krypterad inställning →'; }
};
$('#copy-settings').onclick = async () => {
  try { await navigator.clipboard.writeText($('#encrypted-result').value); $('#copy-status').textContent = 'Kopierat. Du kan nu klistra in inställningen i chatten.'; }
  catch { $('#encrypted-result').focus(); $('#encrypted-result').select(); $('#copy-status').textContent = 'Håll fingret på texten och välj Kopiera.'; }
};

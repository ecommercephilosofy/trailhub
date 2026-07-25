# TRASPÀS — posar el CRM al teu ordinador

Guia per a **Carlos**, per continuar el desenvolupament des del seu propi
ordinador. Escrita assumint zero experiència prèvia amb aquestes eines.

Res del que hi ha aquí és urgent: **el CRM ja funciona i està en línia** a
<https://vitalpe-crm-web-tau.vercel.app>. Això només serveix per poder tocar-hi
codi tu mateix.

---

## 0. Què tens ja, sense fer res

Els tres comptes són **teus** i ja estan configurats i funcionant:

| Servei | Compte | Estat |
| --- | --- | --- |
| GitHub | `carlosespiells-hub` | Repositori **privat** `vitalpe-crm` |
| Supabase | el teu | Base de dades amb 864 empreses i tot l'historial |
| Vercel | equip VITALPE SAT | Desplegament automàtic a cada canvi |

El CRM s'actualitza sol: cada cop que es puja codi a GitHub, Vercel el publica.

---

## 1. Instal·lar les eines (una sola vegada, ~20 min)

### 1.1 Xcode Command Line Tools (només Mac)

Obre l'aplicació **Terminal** (Cmd+Espai → escriu «Terminal») i enganxa:

```bash
xcode-select --install
```

Surt una finestra: **Instal·lar**. Espera que acabi.

### 1.2 Node.js

Cal la versió **20.11 o superior**. Descarrega'l de <https://nodejs.org> — tria
la versió **LTS**. Instal·la-la com qualsevol programa.

Comprova que ha anat bé:

```bash
node --version
```

Ha de dir `v20.11.0` o més alt.

### 1.3 pnpm

És el gestor de paquets que fa servir aquest projecte. Al Terminal:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm --version
```

Ha de dir `10.33.0`.

### 1.4 Git

Els Mac ja el porten. Comprova-ho:

```bash
git --version
```

Si diu que no el troba, s'instal·la amb el pas 1.1.

---

## 2. Baixar el codi

### 2.1 Identificar-te davant de GitHub

El repositori és privat, així que Git t'ha de demanar qui ets. La manera més
senzilla és amb un *token*:

1. Entra a <https://github.com/settings/tokens>
2. **Generate new token** → **classic**
3. Nom: `ordinador-carlos`. Caducitat: la que vulguis.
4. Marca **només** la casella **`repo`**.
5. **Generate token** i copia'l (comença per `ghp_`). **Només es veu un cop.**

### 2.2 Clonar

```bash
cd ~/Documents
git clone https://github.com/carlosespiells-hub/vitalpe-crm.git
cd vitalpe-crm
```

Et demanarà usuari i contrasenya:

- **Username**: `carlosespiells-hub`
- **Password**: enganxa el *token* del pas anterior (no la contrasenya de GitHub)

### 2.3 Instal·lar les dependències

```bash
pnpm install
```

Triga uns minuts la primera vegada.

---

## 3. Les claus (`.env.local`)

El codi és públic per a tu, però **les claus no són al repositori** — mai hi han
de ser. Marc te les passarà per un canal segur (gestor de contrasenyes,
AirDrop, o un fitxer xifrat). **No per WhatsApp ni per correu.**

Quan les tinguis, crea el fitxer:

```bash
cd ~/Documents/vitalpe-crm
open -e .env.local
```

S'obre el TextEdit buit. Enganxa-hi les sis línies que t'ha passat Marc, desa
(Cmd+S) i tanca.

Comprova que les llegeix bé:

```bash
pnpm env:check
```

Ha de dir que troba les variables. **No mostra mai el valor**, només la
llargada — així pots ensenyar la pantalla sense ensenyar les claus.

> ⚠️ `.env.local` està al `.gitignore`: no es puja mai a GitHub. Si algun dia
> el veus a `git status`, para i avisa.

---

## 4. Arrencar-ho

### 4.1 Amb una còpia local (sense tocar les dades reals)

Recomanat per provar coses sense por:

```bash
pnpm import:local -- --fresh   # crea una base local amb les dades reals
pnpm dev                       # engega el CRM
```

Obre <http://localhost:3004>. Entraràs amb un selector d'usuari de prova.

### 4.2 Contra la base de dades real

Si `.env.local` té el `DATABASE_URL` de Supabase, `pnpm dev` ja apunta a les
dades reals. Va bé per veure exactament el que veus a producció, però **el que
canviïs aquí es canvia de veritat**.

### 4.3 Comprovar que tot està sa

```bash
pnpm test        # 673 proves
pnpm build       # compila l'aplicació web
```

Si les dues passen, tens l'entorn ben muntat.

---

## 5. Fer un canvi i publicar-lo

```bash
git add -A
git commit -m "Descriu què has canviat"
git push
```

Vercel ho detecta i publica sol en un parell de minuts. Ho pots seguir a
<https://vercel.com>.

> Si el desplegament falla, quasi sempre és perquè `pnpm build` també falla al
> teu ordinador. Executa'l abans de pujar i t'estalvies el viatge.

---

## 6. Què costa diners, i què no

Aquesta és la part important. **El CRM funciona sencer sense pagar res de tot
això**; cada servei que falta desactiva una funció concreta i l'aplicació t'ho
diu a la pantalla. No es trenca res.

### 6.1 El que ja tens, gratis

| Servei | Cost | Nota |
| --- | --- | --- |
| **Supabase** | 0 € | El pla gratuït aguanta de sobres aquesta base de dades |
| **GitHub** | 0 € | Repositoris privats il·limitats |
| **Google Calendar** | 0 € | L'API de Calendar **no es paga**. Només cal configurar l'OAuth |

### 6.2 El que sí que s'ha de pagar

#### Vercel — allotjament de l'aplicació web

Ara està al pla **Hobby**, que és gratuït però **prohibeix l'ús comercial** a
les seves condicions. Com que això és l'eina de treball d'una empresa, toca el
pla **Pro: ~20 USD/mes**.

No és una qüestió tècnica —funciona igual— sinó legal. Val la pena regularitzar-ho.

#### Google Maps — geolocalització i rutes per distància

- **Preu**: ~5 USD per cada 1.000 adreces geocodificades.
- **Crèdit gratuït**: Google regala **200 USD cada mes**.
- **Cost real per a nosaltres**: les 461 adreces pendents són ~**2,30 USD**, i
  només es paga **una vegada** (les coordenades queden desades). Dins del crèdit
  gratuït, o sigui **0 € de factura**.
- **Però**: Google exigeix una **targeta donada d'alta** encara que no cobri res.

**Què desbloqueja**: que les rutes s'ordenin per distància real i mostrin els
quilòmetres, i que el mòbil pugui avisar-te quan arribes a un client.
**Sense això**: les rutes s'agrupen igualment per comarca, que ja és útil.

> Quan creïs la clau, **restringeix-la** a l'API de Geocoding (Credencials →
> Editar → Restriccions d'API). Una clau de Maps sense restringir que s'escapi
> la pot gastar qualsevol contra la teva targeta.

#### Anthropic (Claude) — entendre les notes de veu

El CRM fa servir **Claude** per llegir una nota dictada i proposar-ne les
accions («truca'l el 5 d'octubre, prioritat alta, i programa visita el 12»).

- **Preu**: per ús, molt baix. Una nota de veu són cèntims.
- **Estimació honesta**: amb un ús normal (unes quantes notes al dia), parlem
  d'uns **pocs euros al mes**. Es pot posar un límit de despesa al panell.
- **On**: <https://console.anthropic.com> → Billing → afegir crèdit.

**Sense això**: hi ha un intèrpret local que funciona de veritat, però només
entén **una acció per nota** i frases més aviat estàndard. El circuit sencer
(dictar → previsualitzar → confirmar) funciona igual.

#### OpenAI — transcriure l'àudio a text

- **Preu**: ~0,006 USD per minut d'àudio (Whisper). Un minut de nota és mig
  cèntim.
- **On**: <https://platform.openai.com> → Billing.

**Sense això**: es pot enganxar la transcripció a mà i la resta funciona igual.
L'àudio no es perd mai.

#### Apple Developer — només si algun dia es publica l'app al mòbil

- **Preu**: **99 USD/any**.
- Ara mateix **no cal**: l'app mòbil està feta i compila, però no s'ha publicat.

### 6.3 Resum de decisions

| Vull... | He de pagar | Aproximadament |
| --- | --- | --- |
| Seguir com ara, legal | Vercel Pro | ~20 USD/mes |
| Rutes per distància + avisos d'arribada | Google Maps (targeta) | ~0 € (dins del crèdit) |
| Notes de veu que entenguin diverses ordres | Anthropic | pocs €/mes |
| Que transcrigui l'àudio sol | OpenAI | cèntims/mes |
| L'app a l'App Store | Apple Developer | 99 USD/any |
| **Seguir desenvolupant amb Claude Code** | Pla Claude Pro | ~20 USD/mes |

**El mínim recomanat**: Vercel Pro (per la legalitat) i Google Maps (perquè no
costa res de fet). Si vols continuar el desenvolupament tu mateix, hi va el pla
de Claude (secció 9). La resta, quan et facin falta.

> Compte amb no barrejar dues coses: el **pla de Claude** és per a tu, per
> programar. La **clau d'API d'Anthropic** és per al CRM, perquè entengui les
> notes de veu. Són dos pagaments diferents i independents; pots tenir l'un
> sense l'altre.

---

## 7. On mirar quan alguna cosa no rutlla

| Document | Per a què |
| --- | --- |
| [`README.md`](README.md) | Visió general i comandes |
| [`ROUTING_AND_PROSPECTING.md`](ROUTING_AND_PROSPECTING.md) | Rutes, zones i prospecció |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Supabase, Vercel, variables |
| [`PERMISSIONS.md`](PERMISSIONS.md) | Qui pot fer què i per què |
| [`DECISIONS.md`](DECISIONS.md) | Per què cada cosa és com és |
| **`ADMINISTRACIÓ → INTEGRACIONS`** | Dins del CRM: diu quines claus falten i com posar-les. **Mai mostra el valor de cap clau.** |

La pantalla d'INTEGRACIONS és el primer lloc on mirar: et dirà exactament què
està configurat i què no, sense haver de tocar cap fitxer.

---

## 8. Regles que val la pena no trencar

1. **`.env.local` no es puja mai a GitHub.** Ja està al `.gitignore`; no el
   treguis.
2. **La `SUPABASE_SERVICE_ROLE_KEY` salta tota la seguretat** de la base de
   dades. Només al servidor, mai al mòbil, mai al navegador.
3. **El repositori es queda privat.** Conté la llista real de clients de
   Vitalpe, amb volums de compra. Fer-lo públic seria publicar-la.
4. **Executa `pnpm test` i `pnpm build` abans de pujar res.** T'estalvia
   desplegaments trencats.
5. **No obris dos processos contra `.data/crm` alhora** (per exemple `pnpm dev` i
   una importació). La base local és d'un sol escriptor i es corromp.

---

## 9. Treballar-hi amb Claude Code

Aquest CRM s'ha construït amb **Claude Code**, i el repositori ve preparat
perquè hi puguis continuar igual des del teu ordinador.

### 9.1 Què necessites

| | |
| --- | --- |
| **Compte de Claude** | Un pla **Pro (~20 USD/mes)** ja et permet fer servir Claude Code. Per a sessions llargues i seguides, el pla **Max** dona molt més marge. També hi ha l'opció de pagar per ús amb una clau d'API, però per treballar-hi cada dia el pla surt més a compte. |
| **Claude Code** | S'instal·la una vegada |

### 9.2 Instal·lar-lo

Al Terminal:

```bash
npm install -g @anthropic-ai/claude-code
```

I després, des de la carpeta del projecte:

```bash
cd ~/Documents/vitalpe-crm
claude
```

El primer cop et demanarà que iniciïs sessió amb el teu compte de Claude. Ja
està: a partir d'aquí li parles en català o castellà i treballa dins d'aquesta
carpeta.

### 9.3 Per què això ja ve configurat

A l'arrel hi ha un fitxer **`CLAUDE.md`**. No és documentació per a persones: és
el que Claude llegeix **abans de tocar res**, cada sessió. Hi consten les regles
que no s'han de tornar a discutir:

- Mai es salta la seguretat de la base de dades (RLS).
- Mai s'inventa una dada: si una font no porta data, no hi ha activitat amb
  data; si una adreça no es pot geolocalitzar, es queda pendent.
- On viu cada regla de negoci, perquè no se'n facin dues còpies que divergeixin.
- Que cal executar `pnpm test` i `pnpm build` abans de donar res per fet.

Això és el que fa que una sessió nova no comenci de zero ni repeteixi errors ja
resolts. **Si canvieu una regla important, actualitzeu `CLAUDE.md`**: és la
memòria del projecte.

També hi ha `.claude/launch.json`, que li diu com engegar el servidor de proves
(`pnpm dev`, port 3004) perquè pugui obrir l'aplicació i comprovar els canvis
ell mateix.

### 9.4 Com demanar-li les coses

Va molt millor amb context que amb ordres soltes. Compara:

> ❌ «arregla el calendari»

> ✅ «Al CALENDARI, quan moc una visita a una altra hora, la tasca vinculada no
> canvia de data. Hauria de seguir la visita. Mira `app.create_visit_with_task`
> i el motor de sincronització.»

Tres costums que valen la pena:

1. **Deixa-li executar les proves.** Si diu que una cosa funciona, demana-li que
   ho demostri amb `pnpm test` o obrint la pàgina.
2. **Revisa el que puja.** `git diff` abans de `git push`. És el teu CRM.
3. **Si toca dades reals, demana-li una simulació primer.** Els scripts
   d'importació i geocodificació ja porten mode simulació (sense `--apply`).

### 9.5 El que no li has de donar mai

**Cap clau, ni per xat.** Ni la de Supabase, ni la de Google, ni cap altra. Van
al fitxer `.env.local`, i Claude les llegeix d'allà sense que ningú les hagi
d'escriure enlloc. Si algun cop et diu que li facin falta, la resposta correcta
és posar-les al fitxer, no enganxar-les a la conversa.

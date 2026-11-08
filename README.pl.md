# Private Chat

Prywatny czat z szyfrowaniem end-to-end zbudowany na Bun, Socket.io, React i Web Crypto.

Wiadomosci nigdy nie sa zapisywane na dysku. Jedynymi danymi trwalymi sa konta (SQLite). Kazda wiadomosc jest szyfrowana za pomoca ECDH P-256 + AES-GCM-256 przed opuszczeniem przegladarki.

## Architektura

```
Private Chat/
  backend/     Serwer Bun + Socket.io (port 3000)
  frontend/    React + Vite + Tailwind CSS (port 5173)
  install.sh   Instalacja jednym poleceniem (zaleznosci + oba serwery)
```

### Backend (`backend/`)

| Modul | Opis |
|---|---|
| `src/index.ts` | Punkt wejscia Bun.serve, health check, graceful shutdown |
| `src/server.ts` | Obsluga zdarzen Socket.io (join, register, login, message, e2ee relay, grupy, czlonkowstwo, vote-kick, disconnect) |
| `src/types.ts` | Typy brandowane, mapy zdarzen, typy payloadow |
| `src/config.ts` | Konfiguracja oparta na zmiennych srodowiskowych |
| `src/account-store.ts` | Trwalosc SQLite przez `bun:sqlite`, bcrypt przez `Bun.password` |
| `src/user-directory.ts` | Union zarejestrowanych kont i nazw gosci (offline czlonkowie grup) |
| `src/group-store.ts` | Grupy i czlonkostwo w pamieci |
| `src/kick-vote-store.ts` | Jedno aktywne glosowanie na wyrzucenie per grupa, TTL 60s |
| `src/user-registry.ts` | Sledzenie aktywnych uzytkownikow w pamieci, TTL 30s przy rozlaczeniu |
| `src/rate-limiter.ts` | Ograniczanie tempa - token bucket (10 zapytan/s na socket) |
| `src/validators.ts` | walidacja Zod dla wszystkich payloadow |
| `src/e2ee.ts` | Kryptograficzne prymitywy ECDH P-256 + HKDF + AES-GCM-256 |
| `src/e2ee-session.ts` | Zarzadzanie kluczami wspoldzielonymi dla kazdego peera |
| `src/logger.ts` | Strukturalny loger Pino |

### Frontend (`frontend/`)

| Modul | Opis |
|---|---|
| `src/App.tsx` | Root: wrapper ChatProvider, bramka autoryzacji |
| `src/context/ChatContext.tsx` | React Context + useReducer dla calego stanu aplikacji |
| `src/lib/socket.ts` | Singleton socket.io-client |
| `src/lib/e2ee.ts` | Prymitywy Web Crypto API (takie same jak w backendzie) |
| `src/lib/e2ee-session.ts` | Zarzadzanie kluczami po stronie klienta |
| `src/components/AuthScreen.tsx` | Kontener z zakladkami Login / Register / Guest |
| `src/components/ChatLayout.tsx` | Uklad z podzielonym panelem (split-pane) |
| `src/components/Sidebar.tsx` | Lista uzytkownikow, baner ephemeral, biezacy uzytkownik |
| `src/components/ChatArea.tsx` | Lista wiadomosci + input + naglowek |
| `src/components/MessageBubble.tsx` | Pojedyncza wiadomosc ze statusem E2EE |
| `src/components/UserItem.tsx` | Wybrany wiersz uzytkownika |

## Szybki start

### Opcja A: install.sh (zalecane)

```bash
chmod +x install.sh
./install.sh
```

Instaluje wszystkie zaleznosci i uruchamia oba serwery.

### Opcja B: Skrypty run.sh

**Wymagania:** [Bun](https://bun.sh) v1.1+, [Node.js](https://nodejs.org) v20+

Otwierz dwa terminale:

```bash
# Terminal 1 - Backend
cd backend
bun install
./run.sh

# Terminal 2 - Frontend
cd frontend
npm install
./run.sh
```

Otworz http://localhost:5173.

### Opcja C: Reczna konfiguracja

```bash
# Backend
cd backend
bun install
bun run src/index.ts

# Frontend (nowy terminal)
cd frontend
npm install
npm run dev
```

## Zmienne srodowiskowe

### Backend

Plik `.env` w katalogu `backend/` zawiera wszystkie domyslne wartosci. Bun wczytuje go automatycznie podczas `bun run`.

| Zmienna | Domyslna | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera |
| `CORS_ORIGINS` | `http://localhost:5173` | Dozwolone origins (oddzielone przecinkami) |
| `LOG_LEVEL` | `info` | Poziom logow Pino (`debug`, `info`, `warn`, `error`) |
| `PING_INTERVAL` | `25000` | Interwal ping Socket.io (ms) |
| `PING_TIMEOUT` | `20000` | Timeout ping Socket.io (ms) |
| `DB_PATH` | `chat.db` | Sciezka do pliku bazy SQLite |
| `TLS_CERT_FILE` | _(nie ustawione)_ | Sciezka do certyfikatu TLS (PEM). Musi byc ustawiona razem z `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | _(nie ustawione)_ | Sciezka do klucza prywatnego TLS (PEM). Musi byc ustawiona razem z `TLS_CERT_FILE` |

### Frontend

| Zmienna | Domyslna | Opis |
|---|---|---|
| `VITE_API_URL` | _(nie ustawione — ten sam origin)_ | URL serwera backendowego. Ustawiany przy budowaniu (np. `VITE_API_URL=https://chat.example.com npm run build`). Jesli nie ustawiony, socket.io laczy sie z tym samym origin (serwer deweloperski Vite w dev, reverse proxy w produkcji). |

## Jak dziala E2EE

1. **Generowanie kluczy:** Kazdy klient generuje pare kluczy ECDH P-256 przy polaczeniu
2. **Wymiana kluczy:** Klucze publiczne sa przekazywane przez serwer do kazdego peera
3. **Wyprowadzanie kluczy:** Kazda strona wyprowadza wspolny klucz AES-256-GCM za pomoca HKDF
4. **Szyfrowanie:** Wiadomosci sa szyfrowane po stronie klienta przed wyslaniem
5. **Deszyfrowanie:** Wiadomosci sa deszyfrowane po stronie klienta po otrzymaniu

Serwer widzi tylko zaszyfrowany tekst. Nie moze odczyt tresci wiadomosci.

```
Klient A                      Serwer                      Klient B
   |                            |                            |
   |-- e2ee:public_key -------->|                            |
   |                            |--- e2ee:public_key ------->|
   |                            |                            |
   |-- message:send(zaszyfrowane) ->|                        |
   |                            |--- private_message ------->|
   |                            |      (tylko szyfr)        |
```

## TLS / HTTPS

Certyfikaty sa zawsze przygotowywane zewnetrznie (certbot, Twoja CA, `openssl`) — aplikacja nie zawiera automatyzacji ACME/Let's Encrypt. Do wyboru sa dwie opcje:

**Opcja A — backend konczy TLS.** Ustaw obie zmienne, a Bun bedzie serwowal `https`/`wss` bezposrednio na `PORT` (obie bez zmian = domyslne czyste `http`):

```bash
TLS_CERT_FILE=/etc/private-chat/fullchain.pem TLS_KEY_FILE=/etc/private-chat/privkey.pem bun run src/index.ts
```

Obie zmienne musza byc ustawione razem; ustawienie tylko jednej konczy sie bledem `TLS_CERT_FILE and TLS_KEY_FILE must be set together`.

**Opcja B — TLS konczy reverse proxy.** Backend zostaje na czystym `http` za nginx (patrz przyklad produkcyjny ponizej, `listen 443 ssl`). W backendzie nic sie nie zmienia.

Klienci nie wymagaja specjalnej konfiguracji: `socket.io-client` sam wywodzi `wss:` z `https:`, a klient mobilny akceptuje adresy serwera `https://` bez zmian. Skieruj ich na https origin:

```bash
# Build frontendu
VITE_API_URL=https://chat.example.com npm run build
```

Ustaw `CORS_ORIGINS` na https origin (np. `https://chat.example.com`). `*` tez dziala, ale nie jest zalecane na produkcji.

Reczny test dymny:

```bash
cd backend
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=localhost"
TLS_CERT_FILE=cert.pem TLS_KEY_FILE=key.pem bun run src/index.ts
curl -k https://localhost:3000/health
```

Po wyczyszczeniu zmiennych serwer nadal musi odpowiadac na `http://localhost:3000/health`.

## Funkcje

- **Szyfrowanie end-to-end** - ECDH + AES-GCM-256, serwer nigdy nie widzi tekstu jawnego
- **System kont** - Rejestracja/login z haslem (bcrypt), opcjonalny PIN
- **Tryb goscia** - Dolacz bez konta (tymczasowa tozsamosc)
- **Offline czlonkowie grup** - Uzytkownikow mozna dodawac do grup, nawet gdy sa offline
- **Vote-kick** - Czlonkowie moga glosowac nad wyrzuceniem czlonka (tworca jest odporny)
- **Trwalosc SQLite** - Konta przetrwaja restart serwera, wiadomosci czatu nie
- **Zero trwalosci czatu** - Brak localStorage, cookies ani serwera do przechowywania wiadomosci
- **Ograniczanie tempa** - Token bucket na socket (10 zapytan/s)
- **Responsywny interfejs** - Podzielony panel na desktopie, stos na urzadzeniach mobilnych
- **Ciemny glassmorphism** - Ciemny motyw zinc z akcentem indigo

## Dane i prywatnosc

Co serwer przechowuje:

- **Konta** - nazwa uzytkownika, hash hasla (bcrypt), opcjonalny hash PIN (SQLite).
- **Nazwy gosci** - nazwa goscia, ktory kiedys dolaczyl, zostaje w malej tabeli katalogowej, zeby mozna bylo dodac te osobe do grupy pozniej, takze gdy jest offline. Dla gosci nie sa przechowywane zadne wiadomosci, dane logowania ani historia obecnosci.

Czego serwer nigdy nie przechowuje: tresci wiadomosci (E2EE, tylko relaya) oraz stanu sesji poza rejestrem w pamieci.

Znane ograniczenia, zaakceptowane przez projekt:

- **Serwer widzi metadane.** Nazwy uzytkownikow, czlonkostwo w grupach, obecnosc i klucze publiczne e2ee sa widoczne dla serwera, bo to on jest relayem. TLS chroni je tylko przed obserwatorami sieci — nie przed operatorem serwera.
- **Brak kolejki wiadomosci offline.** Wiadomosci adresowane do offline uzytkownika nie sa buforowane; nadawca dostaje blad dostarczenia, dokladnie jak wczesniej.
- **Nieaktualna tozsamosc goscia.** Jesli nazwa goscia zostanie pozniej zarejestrowana jako konto, wiersze grup utworzone, gdy byla gosciem, zachowuja stary guest userId i nie sa migrowane. Nowe lookupy rozwiazuja juz na konto.
- **Brak automatyzacji certyfikatow.** Certyfikaty TLS trzeba odnawiac zewnetrznie.

## Stack technologiczny

**Backend:** Bun, Socket.io v4, Zod v4, Pino, bun:sqlite, Bun.password (bcrypt)

**Frontend:** React 19, Vite, TypeScript 6, Tailwind CSS v4, Socket.io-client v4, Biome

## Deweloping

### Testy backendu

```bash
cd backend
bun test
```

### Sprawdzanie typow frontendu

```bash
cd frontend
npm run typecheck
```

### Lint

```bash
# Backend
cd backend && bunx biome check src/

# Frontend
cd frontend && npm run lint
```

## Wdrozenie produkcyjne

### 1. Zbuduj frontend

```bash
cd frontend
npm run build
# Wynik: frontend/dist/
```

### 2. Skonfiguruj reverse proxy (przyklad nginx)

TLS konczy sie w nginx; backend zostaje na czystym `http` (opcja B TLS). Certyfikaty sa przygotowywane zewnetrznie (np. certbot).

```nginx
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Serwuj pliki statyczne frontendu
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Proxy Socket.io do backendu
    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Jesli to backend konczy TLS (opcja A), zmien `proxy_pass` na `https://127.0.0.1:3000`.

### 3. Uruchom backend

```bash
cd backend
PORT=3000 LOG_LEVEL=warn bun run src/index.ts
```

### 4. Uzyj menedzera procesow (opcjonalnie)

```bash
# Przyklad systemd
cat > /etc/systemd/system/private-chat.service << 'EOF'
[Unit]
Description=Private Chat Backend
After=network.target

[Service]
Type=simple
User=chat
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/bun run src/index.ts
Restart=on-failure
Environment=PORT=3000
Environment=LOG_LEVEL=warn
Environment=DB_PATH=/var/lib/private-chat/accounts.db
# Opcjonalne TLS (patrz sekcja TLS / HTTPS)
# Environment=TLS_CERT_FILE=/etc/private-chat/fullchain.pem
# Environment=TLS_KEY_FILE=/etc/private-chat/privkey.pem

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now private-chat
```

## Ograniczenia projektu

- **Brak trwalosci czatu** - Wiadomosci istnieja tylko w pamieci podczas sesji
- **Brak localStorage/cookies** - Stan czatu nigdy nie trafia do pamieci przegladarki
- **Tylko konta sa trwale** - SQLite przechowuje nazwe uzytkownika, hash hasla, hash opcjonalnego PIN
- **TypeScript strict** - `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- **Zerowa tolerancja na `any`** - Zadnych `any`, `!`, ani `@ts-ignore`
- **Ponizej 250 LOC** - Kazdy plik produkcyjny miesci sie w 250 liniach
- **Tylko nazwane eksporty** - Zadnych `export default` gdziekolwiek

## Licencja

Uzytek prywatny.

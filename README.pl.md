# Private Chat

Szyfrowany end-to-end czat z wiadomosciami prywatnymi, grupami i szyfrowanym udostepnianiem zdjec/wideo. Zbudowany na Bun, Socket.io, React, Web Crypto i Flutterze.

Wiadomosci nigdy nie sa zapisywane na dysku. Jedynymi danymi trwalymi sa konta (SQLite). Kazda wiadomosc jest szyfrowana na urzadzeniu nadawcy za pomoca ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM i deszyfrowana tylko na urzadzeniu odbiorcy - serwer przekazuje szyfr, obecnosc i czlonkostwo w grupach.

Projekt ma trzy komponenty: backend na Bun (port 3000), aplikacje webowa React i aplikacje Flutter na Linux desktop oraz Androida.

## Funkcje

- **Szyfrowanie end-to-end** - ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM; serwer nigdy nie widzi tekstu jawnego
- **Wiadomosci prywatne i grupowe** - czlonkowie grupy offline zachowuja czlonkostwo i odnajduja grupe po ponownym dolaczeniu
- **Administracja grupami** - administratorzy dodaja i usuwaja czlonkow; tworca grupy nie moze zostac usuniety ani wyrzucony
- **Vote-kick** - czlonkowie glosuja nad wyrzuceniem kogos; wiekszosc prosta (`floor(liczba_czlonkow / 2) + 1`) w 60 s przeglosowuje usuniecie
- **Gosc i konta** - dolacz jako gosc albo zarejestruj/zaloguj sie haslem i opcjonalnym PIN-em (4-6 cyfr)
- **Szyfrowane udostepnianie mediow** - zdjecia i filmy szyfrowane na urzadzeniu; serwer trzyma nieczytelne bloby w pamieci z TTL 24 h
- **Opcjonalny TLS/HTTPS** - backend moze sam konczyc TLS lub pracowac na czystym `http` za reverse proxy
- **Konfigurowalny adres serwera** - aplikacja Flutter moze wskazac dowolny host w sieci LAN lub domene z ekranu logowania
- **Zero trwalosci czatu** - brak localStorage, cookies ani serwera do przechowywania wiadomosci
- **Ograniczanie tempa** - token bucket, 10 zapytan/s na socket
- **Responsywny interfejs** - podzielony panel na desktopie, stos na urzadzeniach mobilnych; ciemny motyw glass

## Konfiguracja

### Wymagania

- [Bun](https://bun.sh) v1.1+ - backend
- [Node.js](https://nodejs.org) v20+ - frontend webowy
- [Flutter](https://docs.flutter.dev/get-started/install) (kanal stable) - aplikacja mobilna/desktopowa

### Instalacja jednym poleceniem (backend + web)

```bash
chmod +x install.sh
./install.sh
```

Instaluje zaleznosci i uruchamia backend pod http://localhost:3000 oraz frontend deweloperski pod http://localhost:5173. Ctrl+C zatrzymuje oba. Aplikacja Flutter jest konfigurowana osobno ponizej.

### Backend

```bash
cd backend
bun install
bun run src/index.ts
```

Serwer nasluchuje na `PORT` (domyslnie `3000`) i odpowiada na `GET /health`. `bun run dev` nasluchuje zmian w plikach i restartuje przy edycji; `./run.sh` to proste opakowanie `bun run src/index.ts`.

W katalogu `backend/` lezy plik `.env` z domyslnymi wartosciami ponizej; Bun wczytuje go automatycznie podczas `bun run`.

| Zmienna | Domyslna | Opis |
|---|---|---|
| `PORT` | `3000` | Port serwera |
| `CORS_ORIGINS` | `http://localhost:5173` (z `backend/.env`; bez `.env` kod wraca do `*`) | Dozwolone origins (oddzielone przecinkami) dla Socket.io i CORS `/media` |
| `LOG_LEVEL` | `info` | Poziom logow Pino (`debug`, `info`, `warn`, `error`) |
| `DB_PATH` | `chat.db` | Sciezka do pliku bazy SQLite |
| `PING_INTERVAL` | `25000` | Interwal ping Socket.io (ms) |
| `PING_TIMEOUT` | `20000` | Timeout ping Socket.io (ms) |
| `TLS_CERT_FILE` | _(nie ustawione)_ | Sciezka do certyfikatu TLS (PEM). Musi byc ustawiona razem z `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | _(nie ustawione)_ | Sciezka do klucza prywatnego TLS (PEM). Musi byc ustawiona razem z `TLS_CERT_FILE` |

### Frontend webowy

```bash
cd frontend
npm install
npm run dev
```

Otworz http://localhost:5173. W dev Vite proxyuje `/socket.io` i `/media` do `http://localhost:3000`, wiec nie trzeba nic konfigurowac.

Build produkcyjny:

```bash
cd frontend
npm run build        # sprawdzenie typow + bundel -> frontend/dist/
```

| Zmienna | Domyslna | Opis |
|---|---|---|
| `VITE_API_URL` | _(nie ustawione - ten sam origin)_ | URL serwera backendowego, wypalany przy budowaniu (np. `VITE_API_URL=https://chat.example.com npm run build`). Jesli nie ustawiony, socket.io laczy sie z tym samym origin (proxy Vite w dev, reverse proxy w produkcji). |

### Aplikacja Flutter (Linux desktop + Android)

```bash
cd mobile
flutter pub get

flutter run -d linux            # build deweloperski na desktopie
flutter build apk --release     # APK na Androida -> build/app/outputs/flutter-apk/app-release.apk
flutter build linux --release   # pakiet Linux -> build/linux/
```

**Adres serwera.** Domylnie aplikacja laczy sie z `http://localhost:3000`. Na ekranu logowania rozwiw wiersz **Server**, podaj adres backendu i naciskaj Save - na przyklad `http://192.168.1.5:3000` w sieci LAN albo `https://chat.example.com` za TSL-em. Adres jest zapisywany na urzadzeniu i mozna go zmienic tylko przy wylogowaniu.

**Cleartext HTTP na Androidzie.** Manifest Androida ustawia `android:usesCleartextTraffic="true"`, dzieki czemu czyste serwery `http://` w sieci LAN dzialaja od razu. W publicznym internecie uzywaj HTTPS.

### Praca w sieci LAN

1. Podlacz serwer i klientow do tej samej sieci.
2. Otworz port TCP 3000 w zaporze serwera (np. `sudo ufw allow 3000/tcp`).
3. Backend nasluchuje na wszystkich interfejsach. Przy serwerze `192.168.1.5` sprawdz `http://192.168.1.5:3000/health`.
4. Flutter: ustaw wiersz Server na ekranie logowania na `http://192.168.1.5:3000`.
5. Web dev: Vite juz nasluchuje na `0.0.0.0:5173` - otworz `http://192.168.1.5:5173` z innego komputera i dodaj ten origin do `CORS_ORIGINS` w backendzie.

### TLS / HTTPS z domena

Certyfikaty sa zawsze przygotowywane zewnetrznie (certbot, Twoja CA, `openssl`) - aplikacja nie zawiera automatyzacji ACME/Let's Encrypt. Z domena do wyboru sa dwie opcje:

**Opcja A - backend konczy TLS.** Ustaw obie zmienne, a Bun bedzie serwowal `https`/`wss` bezposrednio na `PORT` (obie bez zmian = domyslne czyste `http`):

```bash
TLS_CERT_FILE=/etc/private-chat/fullchain.pem TLS_KEY_FILE=/etc/private-chat/privkey.pem bun run src/index.ts
```

Obie zmienne musza byc ustawione razem; ustawienie tylko jednej konczy sie bledem `TLS_CERT_FILE and TLS_KEY_FILE must be set together`.

**Opcja B - TLS konczy reverse proxy.** Backend zostaje na czystym `http` za nginx (patrz przyklad produkcyjny ponizej, `listen 443 ssl`). W backendzie nic sie nie zmienia.

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

### Wdrozenie produkcyjne

#### 1. Zbuduj frontend webowy

```bash
cd frontend
npm run build
# Wynik: frontend/dist/
```

#### 2. Skonfiguruj reverse proxy (przyklad nginx)

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

    # Proxy wysylek i pobieran mediow do backendu
    location /media/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # nginx domyslnie dopuszcza 1 MB, co dawaloby 413 na kazdym zalaczniku
        client_max_body_size 17m;
    }
}
```

Obie direktwy media sa potrzebne: bez `location /media/` wysylki nie docieraja do backendu, a bez `client_max_body_size 17m;` (plik 16 MiB + 16-bajtowy tag GCM + zapas) domyslny limit 1 MB nginx odrzuca kazde wyslanie kodem 413.

Jesli to backend konczy TLS (opcja A), zmien `proxy_pass` na `https://127.0.0.1:3000`.

#### 3. Uruchom backend

```bash
cd backend
PORT=3000 LOG_LEVEL=warn bun run src/index.ts
```

#### 4. Uzyj menedzera procesow (opcjonalnie)

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
# Opcjonalne TLS (patrz TLS / HTTPS z domena)
# Environment=TLS_CERT_FILE=/etc/private-chat/fullchain.pem
# Environment=TLS_KEY_FILE=/etc/private-chat/privkey.pem

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now private-chat
```

## Architektura

```
Private Chat/
  backend/     Serwer Bun + Socket.io (port 3000)
  frontend/    React + Vite + Tailwind CSS (dev port 5173)
  mobile/      Aplikacja Flutter (Linux desktop + Android)
  install.sh   Instalacja jednym poleceniem (zaleznosci + backend i web)
```

- **Backend** - serwer Bun HTTP obslugujacy `/health`, `/media/*` oraz silnik Socket.io na `/socket.io`. Waliduje kazdy payload przez Zod, przekazuje zdarzenia, trzyma konta i katalog gosci w SQLite, a grupy, glosowania, obecnosc i bloby mediow w pamieci.
- **Frontend webowy** - aplikacja React (SPA). Cala kryptografia dziala w przegladarce przez Web Crypto API; zalaczniki ida przez HTTP `PUT`/`GET /media/:id`.
- **Aplikacja Flutter** - ten sam kontrakt zdarzen i kryptografia co klient webowy, na `socket_io_client` i `dart:io`.

### Moduly backendu (`backend/`)

| Modul | Opis |
|---|---|
| `src/index.ts` | Punkt wejscia Bun.serve, health check, graceful shutdown |
| `src/server.ts` | Obsluga zdarzen Socket.io (join, register, login, message, e2ee relay, grupy, czlonkostwo, vote-kick, disconnect) |
| `src/types.ts` | Typy brandowane, mapy zdarzen, typy payloadow |
| `src/config.ts` | Konfiguracja oparta na zmiennych srodowiskowych (port, CORS, logi, ping, TLS, sciezka DB) |
| `src/account-store.ts` | Trwalosc SQLite przez `bun:sqlite`, bcrypt przez `Bun.password` |
| `src/user-directory.ts` | Union zarejestrowanych kont i nazw gosci (offline czlonkowie grup) |
| `src/group-store.ts` | Grupy i czlonkostwo w pamieci |
| `src/kick-vote-store.ts` | Jedno aktywne glosowanie na wyrzucenie per grupa, TTL 60s |
| `src/user-registry.ts` | Sledzenie aktywnych uzytkownikow w pamieci, TTL 30s przy rozlaczeniu |
| `src/rate-limiter.ts` | Ograniczanie tempa - token bucket (10 zapytan/s na socket) |
| `src/validators.ts` | walidacja Zod dla wszystkich payloadow |
| `src/e2ee.ts` | Kryptograficzne prymitywy ECDH P-256 + HKDF-SHA256 + AES-GCM-256 |
| `src/e2ee-session.ts` | Zarzadzanie kluczami wspoldzielonymi dla kazdego peera |
| `src/media-store.ts` | BLOB-y zalacznikow w pamieci, TTL 24 h, limity, okresowe sprzatanie |
| `src/media-auth.ts` | Tokeny Bearer do mediow (jeden aktywny token na uzytkownika, TTL 24 h) |
| `src/media-http.ts` | Handler `/media/:id` PUT/GET/OPTIONS z CORS i ograniczaniem tempa |
| `src/logger.ts` | Strukturalny loger Pino |

### Moduly frontendu (`frontend/`)

| Modul | Opis |
|---|---|
| `src/App.tsx` | Root: wrapper ChatProvider, bramka autoryzacji |
| `src/context/ChatContext.tsx` | React Context + useReducer dla calego stanu aplikacji |
| `src/lib/socket.ts` | Singleton socket.io-client (uwzglednia `VITE_API_URL`) |
| `src/lib/e2ee.ts` | Prymitywy Web Crypto API (takie same jak w backendzie) |
| `src/lib/e2ee-session.ts` | Zarzadzanie kluczami po stronie klienta |
| `src/components/AuthScreen.tsx` | Kontener z zakladkami Login / Register / Guest |
| `src/components/ChatLayout.tsx` | Uklad z podzielonym panelem (split-pane) |
| `src/components/Sidebar.tsx` | Lista uzytkownikow, baner ephemeral, biezacy uzytkownik |
| `src/components/ChatArea.tsx` | Lista wiadomosci + input + naglowek |
| `src/components/MessageBubble.tsx` | Pojedyncza wiadomosc ze statusem E2EE |
| `src/components/UserItem.tsx` | Wybrany wiersz uzytkownika |

### Moduly aplikacji mobilnej (`mobile/`)

| Modul | Opis |
|---|---|
| `lib/main.dart` | Punkt wejscia aplikacji |
| `lib/src/state/chat_controller.dart` | Stan aplikacji (ChangeNotifier), odpowiednik webowego `ChatContext` |
| `lib/src/net/socket_service.dart` | Polaczenie Socket.io (domyslnie `http://localhost:3000`) |
| `lib/src/net/server_config.dart` | Walidowany, zapisywany adres serwera z ekranu logowania |
| `lib/src/net/chat_events.dart` | Stale nazw zdarzen Socket.io (te same nazwy co w backendzie) |
| `lib/src/net/media_client.dart` | Klient HTTP `PUT`/`GET /media` z tokenem Bearer |
| `lib/src/net/media_opener.dart` | Otwiera pobrany zalacznik w zewnetrznej przegladarce |
| `lib/src/crypto/e2ee.dart` | Prymitywy ECDH P-256 + HKDF-SHA256 + AES-GCM-256 |
| `lib/src/crypto/e2ee_session.dart` | Zarzadzanie kluczami wspoldzielonymi dla kazdego peera |
| `lib/src/crypto/media_crypto.dart` | Szyfrowanie per plik (klucz pliku + IV, SHA-256) |
| `lib/src/models/` | Modele protokolu: user, group, message, media, auth, errors |
| `lib/src/ui/` | Ekrany (logowanie, powloka czatu, lista rozmow) i widgety |

### Kontrakt zdarzen Socket.io

Pelne typy leza w `backend/src/types.ts`; klient Flutter powtarza nazwy w `lib/src/net/chat_events.dart`.

**Klient -> serwer:**

| Zdarzenie | Cel |
|---|---|
| `user:join` | Dolacz jako gosc z nazwa uzytkownika |
| `user:register`, `user:login` | Autoryzacja konta (haslo, opcjonalny PIN) |
| `e2ee:public_key` | Wyslanie wlasnego klucza publicznego ECDH do jednego peera |
| `message:send` | Przekazanie jednej zaszyfrowanej wiadomosci prywatnej (`to`, `ciphertext`, `iv`) |
| `group:create` | Utworzenie grupy z nazwy i listy nazw czlonkow (offline dozwolony) |
| `group:member:add`, `group:member:remove` | Zmiany czlonkostwa tylko dla adminow |
| `group:kick:vote` | Glosowanie na wyrzucenie czlonka (wymagana wiekszosc, okno 60 s) |
| `group:message:send` | Wiadomosc grupowa: jeden szyfr na czlonka, dla ktorego nadawca ma klucz wspoldzielony |

**Serwer -> klient:**

| Zdarzenie | Cel |
|---|---|
| `user:joined`, `user:left`, `active_users` | Lista obecnosci |
| `users:directory` | Wszystkie znane nazwy (konta + goscie), dzieki czemu offline czlonkowie moga trafic do grup |
| `active_groups` | Zrzut grup przy dolaczeniu, potem aktywne jeszcze glosowania |
| `e2ee:public_key` | Przekazany klucz publiczny peera (klucz wyslany przez klienta jest tez odsylany do niego - to daje klucz wlasny potrzebny do odszyfrowania wlasnych odbic grupowych) |
| `private_message` | Wiadomosc prywatna wylacznie z szyfrem |
| `group:message` | Wiadomosc grupowa z szyframi per czlonek |
| `group:created`, `group:created_error`, `group:message_delivery_failed`, `group:member:removed`, `group:kick:tally` | Cykl zycia grupy, zmiany czlonkostwa, na zywo liczace sie glosy (`active` / `passed` / `expired`) |
| `delivery_failed`, `message_rejected`, `error` | Bledy - nie ma kolejki offline, wiadomosc do offline uzytkownika od razu konczy sie niepowodzeniem |
| `register_success` / `register_error`, `login_success` / `login_error` | Wyniki autoryzacji |
| `media:token` | Token Bearer do HTTP-owych endpointow mediow |

Po udanym join, register lub login serwer wysyla zrzut: `active_groups`, `users:directory`, aktywne glosowania, `media:token` oraz `active_users`.

## Jak dziala E2EE

1. **Generowanie kluczy:** kazdy klient generuje pare kluczy ECDH P-256 przy polaczeniu
2. **Wymiana kluczy:** po zrzucie `active_users` klient wysyla swoj klucz publiczny do kazdego aktywnego uzytkownika; gdy ktos nowy dolacza, dotychczasowi klienci wysylaja swoje klucze do niego. Serwer tylko przekazuje.
3. **Wyprowadzanie kluczy:** kazda strona wyprowadza wspolny klucz AES-256-GCM przez HKDF-SHA256 (pusty salt, info `private-chat-e2ee-v1`)
4. **Szyfrowanie:** wiadomosci sa szyfrowane po stronie klienta przed wyslaniem
5. **Deszyfrowanie:** wiadomosci sa deszyfrowane po stronie klienta po otrzymaniu

W grupach nadawca szyfruje ten sam tekst raz na czlonka, dla ktorego ma klucz wspoldzielony (wlacznie z wlasna kopia, zeby moc wyswietlic wlasna wiadomosc) i wysyla tablice szyfrow; serwer rozsyla te sama tablice do kazdego czlonka.

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

## Udostepnianie mediow

Zdjecia i filmy podrzucane sa jako **zaszyfrowane po stronie klienta zalaczniki**. Nadawca generuje losowy 32-bajtowy klucz pliku i 12-bajtowy IV na plik, usuwa metadane EXIF z obrazow, szyfruje plik AES-256-GCM i wysyla szyfrogram przez `PUT /media/:id`. Wiadomosc czatu wskazujaca plik to zwykla wiadomosc E2EE, ktorej odszyfrowany tekst niesie deskryptor (`fileId`, klucz, IV, SHA-256 szyfrogramu, mime, rozmiar, wymiary, oryginalna nazwa). Klucz pliku nigdy nie opuszcza tresci wiadomosci E2EE - serwer przechowuje nieczytelne bajty. Odbiorca przed odszyfrowaniem porownuje SHA-256 z deskryptorem, wiec podmieniony plik zostaje odrzucony.

### Wydawanie tokenow

Kazde `user:join`, `user:register` i `user:login` konczy sie zdarzeniem `media:token` z tokenem Bearer do wywolan HTTP: 32 losowe bajty zapisane jako 64 male znaki hex, wazne 24 h od wydania. Jeden aktywny token na nazwe uzytkownika - ponowne uwierzytelnienie zastepuje poprzedni token, ktory przestaje dzialac natychmiast. Tokeny zyja tylko w pamieci procesu.

### Koncje HTTP

| Metoda | Sciezka | Auth | Sukces | Bledy |
|---|---|---|---|---|
| `PUT` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `201 {"ok":true}` (powtorzony PUT z tym samym id zastepuje wpis) | `400 {"error":"invalid_id"}`, `401 {"error":"unauthorized"}`, `404 {"error":"not_found"}`, `405 {"error":"method_not_allowed"}`, `413 {"error":"too_large"}`, `429 {"error":"rate_limited"}`, `429 {"error":"quota_exceeded"}` |
| `GET` | `/media/:id` | `Authorization: Bearer <mediaToken>` | `200`, cialo = szyfrogram jako `application/octet-stream` z `Cache-Control: no-store` | `400`, `401`, `404 {"error":"not_found"}` (brak lub wygasly) |
| `OPTIONS` | `/media/*` | preflight CORS | `204` + naglowki CORS | - |

Wysylki sa limitowane do 10 PUT/s na token. Serwer przechowuje dokladnie bajty szyfrogramu - bez parsowania, bez transformacji.

### Limity, TTL, wyzerowanie przy awarii

- **Tylko w pamieci** - pliki nigdy nie trafiaja na dysk ani do SQLite. Restart lub awaria kasuje wszystkie zalaczniki; klienty pokazuja wtedy `Attachment expired`.
- **Limity** - 16 MiB na plik (limit w sieci to 16 MiB + 16-bajtowy tag GCM), lacznie 512 MB i 1000 plikow.
- **TTL** - 24 godziny od wysylki; wygasle pliki sa sprzatane co 30 sekund. Nie ma usuwania po pobraniu, wiec kazdy odbiorca moze pobrac ten sam plik.

### URL jako uprawnienie

`GET /media/:id` wymaga waznego tokena, ale kazdy posiadacz tokena z `fileId` moze pobrac plik. Serwer nie zna odbiorcow - deskryptor lezy w szyfrowanej tresci E2EE - wiec `fileId` jest uprawnieniem: losowy UUID v4 wybrany przez klienta (122 bity) jest nieodgadywalny, to ten sam model capability-URL, ktorego uzywaja WhatsApp i Matrix do plikow CDN. Tokeny nie pozwalaja osiagnac konca anonimowo.

### Zaakceptowane luki

- Kontenery wideo nie sa czyszczone - EXIF nosza tylko obrazy, wiec tylko obrazy sa przycinane.
- Token przetrwuje jawne wylogowanie do 24 h; zyje tylko w pamieci procesu i jest zastepowany przy najblizszym logowaniu.
- Stare klienty dostajace wiadomosc media pokazuja surowy JSON koperty jako tekst - z degradacja, nigdy z awaria.

## Dane i prywatnosc

Co serwer przechowuje:

- **Konta** - nazwa uzytkownika, hash hasla (bcrypt), opcjonalny hash PIN (SQLite).
- **Szyfrogramy zalacznikow** - wyslane zdjecia/wideo trzymane tylko w pamieci procesu (16 MiB na plik, lacznie 512 MB / 1000 plikow, TTL 24 h). Nigdy na dysku; zerowane przy resecie.
- **Nazwy gosci** - nazwa goscia, ktory kiedys dolaczyl, zostaje w malej tabeli katalogowej, zeby mozna bylo dodac te osobe do grupy pozniej, takze gdy jest offline. Dla gosci nie sa przechowywane zadne wiadomosci, dane logowania ani historia obecnosci.

Czego serwer nigdy nie przechowuje: tresci wiadomosci (E2EE, tylko relaya) oraz stanu sesji poza rejestrem w pamieci.

Znane ograniczenia, zaakceptowane przez projekt:

- **Serwer widzi metadane.** Nazwy uzytkownikow, czlonkostwo w grupach, obecnosc i klucze publiczne e2ee sa widoczne dla serwera, bo to on jest relayem. TLS chroni je tylko przed obserwatorami sieci - nie przed operatorem serwera.
- **Brak kolejki wiadomosci offline.** Wiadomosci adresowane do offline uzytkownika nie sa buforowane; nadawca dostaje blad dostarczenia, dokladnie jak wczesniej.
- **Nieaktualna tozsamosc goscia.** Jesli nazwa goscia zostanie pozniej zarejestrowana jako konto, wiersze grup utworzone, gdy byla gosciem, zachowuja stary guest userId i nie sa migrowane. Nowe lookupy rozwiazuja juz na konto.
- **Brak automatyzacji certyfikatow.** Certyfikaty TLS trzeba odnawiac zewnetrznie.

## Testowanie

### Backend

```bash
cd backend
bun test               # testy jednostkowe
bun run typecheck      # tsc --noEmit
bunx biome check src/  # lint
```

### Frontend webowy

```bash
cd frontend
npm run typecheck
npm run lint
```

### Aplikacja Flutter

```bash
cd mobile
flutter analyze
flutter test
```

### Test E2E na zywo

Uruchom backend, potem odpal suite na zywo z `RUN_LIVE_E2E=1` (bez tej zmiennej suite jest pomijany):

```bash
# Terminal 1 - backend
cd backend
bun run src/index.ts

# Terminal 2 - E2E na zywo
cd mobile
RUN_LIVE_E2E=1 flutter test test/e2e_live_test.dart
```

Suite steruje prawdziwymi klientami `ChatController` na dzialajacym backendzie i sprawdza dwukierunkowe wiadomosci E2EE miedzy dwoma klientami, czlonkostwo w grupie (zaproszony offline, remove przez admina, przeglosowane wyrzucenie, katalog uzytkownikow) oraz pelny obieg zalacznika (wysylka -> deskryptor przez E2EE -> pobranie -> porownanie bajt po bajcie). `SERVER_URL` zmienia cel (`http://localhost:3000` domyslnie).

## Stack technologiczny

**Backend:** Bun, Socket.io v4, Zod v4, Pino, bun:sqlite, Bun.password (bcrypt)

**Web:** React 19, Vite, TypeScript 6, Tailwind CSS v4, Socket.io-client v4, Biome

**Mobile:** Flutter/Dart, socket_io_client, cryptography, pointycastle, shared_preferences, file_picker

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
